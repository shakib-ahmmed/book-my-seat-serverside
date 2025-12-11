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

async function run() {
    try {
        await client.connect();
        console.log("Connected to MongoDB!");
        const db = client.db("BookMySeatDB");
        userCollection = db.collection("users");
        await db.command({ ping: 1 });
        console.log("Ping successful!");
    } catch (err) {
        console.error(err);
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
    const { email } = req.params
    const tickets = await Tickets.find({ addedBy: email }).toArray()
    res.json(tickets)
})


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
