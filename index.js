require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Allowed origins for CORS
const allowedOrigins = ['http://localhost:4000', 'http://localhost:5173'];

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();

    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header(
            'Access-Control-Allow-Headers',
            'Origin, X-Requested-With, Content-Type, Accept, Authorization'
        );
        res.header(
            'Access-Control-Allow-Methods',
            'GET, POST, PUT, PATCH, DELETE, OPTIONS'
        );
    }

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.use(express.json());

// MongoDB connection
const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: { version: ServerApiVersion.v1 }
});

let userCollection, ticketsCollection, bookingsCollection;

async function run() {
    try {
        const db = client.db('bookmyseat-DB');
        userCollection = db.collection("users");
        ticketsCollection = db.collection("tickets");
        bookingsCollection = db.collection("bookings");

        console.log("MongoDB connected!");
    } catch (err) {
        console.error("MongoDB Error:", err);
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send("BOOKMYSEAT server is running!");
});

// Get user role
app.get('/user/role', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ error: "Email is required" });

        const user = await userCollection.findOne({ email });
        res.json({ role: user?.role || 'customer' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Get all tickets
app.get('/tickets', async (req, res) => {
    try {
        const status = req.query.status || 'approved';
        const search = req.query.search || '';
        const sortBy = req.query.sortBy || 'price';
        const order = req.query.order === 'desc' ? -1 : 1;

        const query = {
            status,
            title: { $regex: search, $options: 'i' }
        };

        const tickets = await ticketsCollection.find(query)
            .sort({ [sortBy]: order })
            .toArray();

        const formattedTickets = tickets.map(t => ({ ...t, _id: t._id.toString() }));
        res.json(formattedTickets);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch tickets" });
    }
});

// Get single ticket by ID
app.get('/tickets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid ticket ID" });

        const ticket = await ticketsCollection.findOne({ _id: new ObjectId(id) });
        if (!ticket) return res.status(404).json({ message: "Ticket not found" });

        res.json({ ...ticket, _id: ticket._id.toString() });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch ticket" });
    }
});

// Book a ticket
app.post('/bookings', async (req, res) => {
    try {
        const { ticketId, quantity, status, departure, email } = req.body;

        if (!ticketId || !quantity || !email) {
            return res.status(400).json({ message: "ticketId, quantity, and email are required" });
        }

        if (!ObjectId.isValid(ticketId)) {
            return res.status(400).json({ message: "Invalid ticket ID" });
        }

        const ticket = await ticketsCollection.findOne({ _id: new ObjectId(ticketId) });
        if (!ticket) return res.status(404).json({ message: "Ticket not found" });

        if (!ticket.quantity || ticket.quantity < quantity) {
            return res.status(400).json({ message: "Not enough tickets available" });
        }

        const result = await bookingsCollection.insertOne({
            ticketId,
            email,
            quantity,
            status: status || "Pending",
            departure,
            createdAt: new Date(),
        });

        await ticketsCollection.updateOne(
            { _id: new ObjectId(ticketId) },
            { $inc: { quantity: -quantity } }
        );

        res.status(201).json({ message: "Booking successful", bookingId: result.insertedId });
    } catch (err) {
        console.error("Booking error:", err);
        res.status(500).json({ message: "Failed to book ticket" });
    }
});

// Get tickets booked by a user
app.get('/my-tickets', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ message: "Email is required" });

        const bookings = await bookingsCollection.find({ email }).toArray();

        const detailedBookings = await Promise.all(
            bookings.map(async (b) => {
                const ticket = await ticketsCollection.findOne({ _id: new ObjectId(b.ticketId) });
                return {
                    ...b,
                    ticket: ticket ? { ...ticket, _id: ticket._id.toString() } : null
                };
            })
        );

        res.json(detailedBookings);
    } catch (err) {
        console.error("My Tickets error:", err);
        res.status(500).json({ message: "Failed to fetch your tickets" });
    }
});

// Stripe payment intent
app.post('/create-payment-intent', async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount) return res.status(400).json({ error: "Amount is required" });

        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: 'bdt',
        });

        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Payment failed" });
    }
});

// Add a new ticket
app.post('/tickets', async (req, res) => {
    try {
        const ticket = req.body;
        ticket.createdAt = new Date();
        const result = await ticketsCollection.insertOne(ticket);
        res.status(201).json({ ...ticket, _id: result.insertedId.toString() });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to add ticket" });
    }
});

// Delete ticket
app.delete('/tickets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid ticket ID" });

        await ticketsCollection.deleteOne({ _id: new ObjectId(id) });
        res.json({ message: "Ticket deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to delete ticket" });
    }
});

// Create or update a user with a role
app.post('/users', async (req, res) => {
    try {
        const { email, name, role } = req.body;
        if (!email || !role) return res.status(400).json({ message: "Email and role are required" });

        const existingUser = await userCollection.findOne({ email });

        if (existingUser) {
            await userCollection.updateOne(
                { email },
                { $set: { role, name: name || existingUser.name } }
            );
            return res.json({ message: "User role updated successfully" });
        }
        const result = await userCollection.insertOne({
            email,
            name: name || email.split('@')[0],
            role,
            createdAt: new Date()
        });

        res.status(201).json({ message: "User created successfully", userId: result.insertedId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to create/update user" });
    }
});



app.patch('/users/:id/role', async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid user ID" });

        await userCollection.updateOne({ _id: new ObjectId(id) }, { $set: { role } });
        res.json({ message: 'Role updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to update role' });
    }
});

app.patch('/users/:id/fraud', async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid user ID" });

        await userCollection.updateOne({ _id: new ObjectId(id) }, { $set: { fraud: true } });
       
        await ticketsCollection.updateMany({ vendorId: id }, { $set: { status: 'hidden' } });

        res.json({ message: 'Vendor marked as fraud' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to mark as fraud' });
    }
});



app.get('/users', async (req, res) => {
    try {
        const users = await userCollection.find().toArray();
        const formattedUsers = users.map(u => ({
            ...u,
            _id: u._id.toString()
        }));
        res.json(formattedUsers);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch users" });
    }
});

// Update user role
app.patch('/users/:id/role', async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid user ID" });
        if (!role) return res.status(400).json({ message: "Role is required" });

        const result = await userCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role } }
        );

        res.json({ message: "User role updated successfully", modifiedCount: result.modifiedCount });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update user role" });
    }
});


// Start server
app.listen(port, () => {
    console.log(`BOOKMYSEAT Server listening on port ${port}`);
});
