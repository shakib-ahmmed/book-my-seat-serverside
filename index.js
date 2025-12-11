// backend/index.js
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = 5000;


app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));

app.use(express.json());




// MongoDB connection
const uri = "mongodb+srv://ticket-admin:v76VvNU4EJVvLnpv@cluster0.ovreryk.mongodb.net/?appName=Cluster0";
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let userCollection;
let ticketsCollection;
let addedTicketsCollection;

async function run() {
    try {

        const db = client.db('bookmyseat-DB');
        userCollection = db.collection("users");
        ticketsCollection = db.collection("tickets");

        addedTicketsCollection = db.collection("addedTickets");
        bookingsCollection = db.collection("bookings");

    } catch (err) {
        console.error("MongoDB Error:", err);
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send("BOOKMYSEAT server is running!");
});

// Become vendor request
app.post('/become-vendor', async (req, res) => {
    const { userEmail } = req.body;
    res.json({ message: 'Successfully requested to become vendor', userEmail });
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

// Get tickets added by a vendor
app.get('/my-added-tickets/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const tickets = await addedTicketsCollection.find({ addedBy: email }).toArray();
        res.json(tickets);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to fetch added tickets' });
    }
});

// Get tickets bought by a user
app.get('/my-tickets', async (req, res) => {
    const email = req.query.email;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    try {
        const tickets = await ticketsCollection.find({ buyerEmail: email }).toArray();
        res.json(tickets);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to fetch tickets' });
    }
});

// Get users by role
app.get('/users', async (req, res) => {
    try {
        const role = req.query.role;
        if (!role) return res.status(400).json({ error: "Role is required" });

        const users = await userCollection.find({ role }).toArray();
        res.json(users);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// Get all tickets 
app.get('/tickets', async (req, res) => {
    const status = req.query.status || 'approved';
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'price';
    const order = req.query.order === 'desc' ? -1 : 1;

    try {
        const query = {
            status,
            title: { $regex: search, $options: 'i' }
        };

        const tickets = await ticketsCollection
            .find(query)
            .sort({ [sortBy]: order })
            .toArray();

        const formattedTickets = tickets.map(t => ({ ...t, _id: t._id.toString() }));
        res.json(formattedTickets);
    } catch (err) {
        console.error("Backend /tickets error:", err);
        res.status(500).json({ message: 'Failed to fetch tickets' });
    }
});

// Get single ticket by ID
app.get('/tickets/:id', async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid ticket ID" });

    try {
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
        const booking = req.body;
        const { ticketId, quantity } = booking;

        if (!ticketId || !quantity) {
            return res.status(400).json({ message: "ticketId and quantity are required" });
        }

        const ticket = await ticketsCollection.findOne({ _id: new ObjectId(ticketId) });
        if (!ticket) return res.status(404).json({ message: "Ticket not found" });
        if (ticket.quantity < quantity) {
            return res.status(400).json({ message: "Not enough tickets available" });
        }

        const result = await bookingsCollection.insertOne({
            ...booking,
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
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid ticket ID" });

    try {
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
