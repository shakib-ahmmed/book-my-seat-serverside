const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = 3000;

app.use(cors());
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
let TicketsCollection; 
let AddedTicketsCollection;

async function run() {
    try {
        await client.connect();
        console.log("Connected to MongoDB!");

        const db = client.db("BookMySeatDB");

        userCollection = db.collection("users");
        AddedTicketsCollection = db.collection("addedTickets");
        TicketsCollection = db.collection("tickets");

        await db.command({ ping: 1 });
        console.log("Ping successful!");
    } catch (err) {
        console.error("Mongo DB Error:", err);
    }
}
run().catch(console.dir);


// Routes
app.get('/', (req, res) => {
    res.send("Server is running fine!");
});

// Become vendor
app.post('/become-vendor', async (req, res) => {
    const { userEmail } = req.body;
    res.json({ message: 'Successfully requested to become vendor' });
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

// Vendor added tickets
app.get('/my-added-tickets/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const tickets = await AddedTicketsCollection.find({ addedBy: email }).toArray();
        res.json(tickets);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to fetch added tickets' });
    }
});

// Buyer purchased tickets
app.get('/my-tickets', async (req, res) => {
    const email = req.query.email;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    try {
        const tickets = await TicketsCollection.find({ buyerEmail: email }).toArray();
        res.json(tickets);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to fetch tickets' });
    }
});


app.listen(port, () => {
    console.log(`BOOKMYSEAT Server listening on port ${port}`);
});
