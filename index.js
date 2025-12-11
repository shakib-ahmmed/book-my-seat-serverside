
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;


app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

// MongoDB connection
const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: { version: ServerApiVersion.v1 }
});

let userCollection, ticketsCollection, addedTicketsCollection, bookingsCollection;

async function run() {
    try {
        const db = client.db('bookmyseat-DB');
        userCollection = db.collection("users");
        ticketsCollection = db.collection("tickets");
        addedTicketsCollection = db.collection("addedTickets");
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
        const { ticketId, quantity, status, departure } = req.body;

        if (!ticketId || !quantity) {
            return res.status(400).json({ message: "ticketId and quantity are required" });
        }

        const ticket = await ticketsCollection.findOne({ _id: new ObjectId(ticketId) });
        if (!ticket) return res.status(404).json({ message: "Ticket not found" });
        if (ticket.quantity < quantity) {
            return res.status(400).json({ message: "Not enough tickets available" });
        }

        const result = await bookingsCollection.insertOne({
            ticketId,
            quantity,
            status: status || "Pending",
            departure,
            createdAt: new Date()
        });


        await ticketsCollection.updateOne(
            { _id: new ObjectId(ticketId) },
            { $inc: { quantity: -quantity } }
        );

        res.status(201).json({ message: "Booking successful", bookingId: result.insertedId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to book ticket" });
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


// Start server
app.listen(port, () => {
    console.log(`BOOKMYSEAT Server listening on port ${port}`);
});
