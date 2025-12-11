const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const port = 3000;

app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true,
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
        await client.connect();
        console.log("Connected to MongoDB!");

        const db = client.db("BookMySeatDB");

        userCollection = db.collection("users");
        addedTicketsCollection = db.collection("addedTickets");
        ticketsCollection = db.collection("tickets");

        await db.command({ ping: 1 });
        console.log("Ping successful!");
    } catch (err) {
        console.error("MongoDB Error:", err);
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send("Server is running fine!");
});


app.post('/become-vendor', async (req, res) => {
    const { userEmail } = req.body;
    res.json({ message: 'Successfully requested to become vendor' });
});


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


const db = client.db('bookmyseat-DB')
const modelCollection = db.collection('tickets')


app.get('/tickets', async (req, res) => {
    const status = req.query.status || 'approved';
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'price';
    const order = req.query.order === 'desc' ? -1 : 1;

    try {
        const query = {
            status: status,
            title: { $regex: search, $options: 'i' }
        };

        const tickets = await ticketsCollection
            .find(query)
            .sort({ [sortBy]: order })
            .toArray();

        res.json(tickets);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to fetch tickets' });
    }
});





app.listen(port, () => {
    console.log(`BOOKMYSEAT Server listening on port ${port}`);
});
