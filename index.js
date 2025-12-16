require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins = [
    'http://localhost:5173',
    'https://book-my-seat-77125.web.app',
    'https://book-my-seat-77125.firebaseapp.com'
];

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

let userCollection, ticketsCollection, bookingsCollection, vendorRequestsCollection;

app.get('/', (req, res) => {
    res.send("BOOKMYSEAT server is running!");
});


async function run() {
    try {
        await client.connect();
        const db = client.db('bookmyseat-DB');

        userCollection = db.collection("users");
        ticketsCollection = db.collection("tickets");
        bookingsCollection = db.collection("bookings");
        vendorRequestsCollection = db.collection("vendorRequests");

        console.log("MongoDB connected!");



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

        app.patch('/users/:id/role', async (req, res) => {
            try {
                const { id } = req.params;
                const { role } = req.body;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ message: "Invalid user ID" });
                }

                if (!role) {
                    return res.status(400).json({ message: "Role is required" });
                }

                const result = await userCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role } }
                );

                res.json({
                    message: "User role updated successfully",
                    modifiedCount: result.modifiedCount
                });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to update user role" });
            }
        });


        // Get all tickets
        app.get('/tickets', async (req, res) => {
            try {
                const search = req.query.search || '';
                const sortBy = req.query.sortBy || 'price';
                const order = req.query.order === 'desc' ? -1 : 1;
                const advertise = req.query.advertise === 'true';

                const query = {
                    title: { $regex: search, $options: 'i' }
                };

                if (advertise) query.advertise = true;

                const tickets = await ticketsCollection.find(query).sort({ [sortBy]: order }).toArray();

                res.json(tickets.map(t => ({
                    ...t,
                    _id: t._id.toString()
                })));
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: 'Failed to fetch tickets' });
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
                console.log("Fetching tickets for:", email);

                if (!email) return res.status(400).json({ message: "Email is required" });

                const bookings = await bookingsCollection.find({ email }).toArray();
                console.log("Found bookings:", bookings.length);

                const detailedBookings = await Promise.all(
                    bookings.map(async (b) => {
                        const ticket = await ticketsCollection.findOne({ _id: new ObjectId(b.ticketId) });
                        return {
                            ...b,
                            _id: b._id.toString(),
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
                const {
                    title,
                    from,
                    to,
                    transportType,
                    price,
                    quantity,
                    departure,
                    perks,
                    image,
                    vendorName,
                    vendorEmail
                } = req.body;

                if (!title || !from || !to || !transportType || !price || !quantity || !departure || !vendorEmail) {
                    return res.status(400).json({ message: "Missing required fields" });
                }

                const newTicket = {
                    title,
                    from,
                    to,
                    transportType,
                    price: Number(price),
                    quantity: Number(quantity),
                    sold: 0,
                    departure: new Date(departure),
                    perks: Array.isArray(perks) ? perks : [],
                    image: image || null,
                    vendorName: vendorName || '',
                    vendorEmail,
                    status: "pending",
                    advertise: false,
                    createdAt: new Date(),
                };

                const result = await ticketsCollection.insertOne(newTicket);

                res.status(201).json({
                    message: "Ticket added successfully",
                    ticketId: result.insertedId,
                    ticket: { ...newTicket, _id: result.insertedId.toString() },
                });
            } catch (err) {
                console.error("Failed to add ticket:", err);
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
                if (!email) return res.status(400).json({ message: "Email is required" });

                const existingUser = await userCollection.findOne({ email });

                if (existingUser) {
                    if (role) {
                        await userCollection.updateOne(
                            { email },
                            { $set: { role, name: name || existingUser.name } }
                        );
                        return res.json({ message: "User updated successfully", role });
                    }
                    return res.json({ message: "User exists", role: existingUser.role });
                }

                const newUser = {
                    email,
                    name: name || email.split('@')[0],
                    role: role === "vendor" || role === "admin" ? role : "user",
                    createdAt: new Date()
                };

                const result = await userCollection.insertOne(newUser);

                res.status(201).json({
                    message: "User created successfully",
                    userId: result.insertedId,
                    role: newUser.role
                });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to create/update user" });
            }
        });

        // Get user role
        app.get('/user/role', async (req, res) => {
            try {
                const { email } = req.query;
                if (!email) return res.status(400).json({ message: "Email is required" });

                const user = await userCollection.findOne({ email });
                res.json({ role: user?.role || "user" });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to fetch role" });
            }
        });

        // Update user role by ID
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


        // Get all users
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


        // Get tickets added by a specific vendor
        app.get('/my-added-tickets/:email', async (req, res) => {
            try {
                const { email } = req.params;
                if (!email) return res.status(400).json({ message: "Email is required" });

                const tickets = await ticketsCollection.find({ vendorEmail: email }).toArray();
                const formattedTickets = tickets.map(t => ({ ...t, _id: t._id.toString() }));

                res.json(formattedTickets);
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to fetch tickets" });
            }
        });


        app.get('/vendor-requests', async (req, res) => {
            try {
                const requests = await vendorRequestsCollection.find({}).toArray();
                res.send(requests);
            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch vendor requests' });
            }
        });

        // Get all bookings 
        app.get('/bookings', async (req, res) => {
            try {
                const status = req.query.status;
                const query = {};

                if (status) {
                    query.status = status;
                }

                const bookings = await bookingsCollection.find(query).toArray();

                const detailedBookings = await Promise.all(
                    bookings.map(async (b) => {
                        const ticket = await ticketsCollection.findOne({ _id: new ObjectId(b.ticketId) });
                        return {
                            ...b,
                            ticket: ticket ? { ...ticket, _id: ticket._id.toString() } : null,
                        };
                    })
                );

                res.json(detailedBookings);
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to fetch bookings" });
            }
        });


        // Revenue overview 
        app.get('/revenue-overview/:vendorEmail', async (req, res) => {
            try {
                const { vendorEmail } = req.params;
                if (!vendorEmail) return res.status(400).json({ message: "Vendor email is required" });

                const tickets = await ticketsCollection.find({ vendorEmail }).toArray();
                const totalTicketsAdded = tickets.reduce((sum, t) => sum + (t.quantity || 0), 0);
                const totalTicketsSold = tickets.reduce((sum, t) => sum + (t.sold || 0), 0);
                const totalRevenue = tickets.reduce((sum, t) => sum + ((t.sold || 0) * (t.price || 0)), 0);

                res.json({
                    totalTicketsAdded,
                    totalTicketsSold,
                    totalRevenue,
                    tickets: tickets.map(t => ({
                        ...t,
                        _id: t._id.toString(),
                        sold: t.sold || 0,
                        advertise: t.advertise || false,
                    }))
                });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to fetch revenue overview" });
            }
        });

        app.get('/vendor-tickets', async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) return res.status(400).json({ message: "Email is required" });

                const tickets = await ticketsCollection.find({ vendorEmail: email }).toArray();
                const formattedTickets = tickets.map(t => ({ ...t, _id: t._id.toString() }));

                res.json(formattedTickets);
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to fetch vendor tickets" });
            }
        });

        app.get('/tickets', async (req, res) => {
            try {
                const search = req.query.search || '';
                const sortBy = req.query.sortBy || 'price';
                const order = req.query.order === 'desc' ? -1 : 1;

                const query = { title: { $regex: search, $options: 'i' } };
                const tickets = await ticketsCollection.find(query).sort({ [sortBy]: order }).toArray();
                res.json(tickets.map(t => ({ ...t, _id: t._id.toString() })));
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: 'Failed to fetch tickets' });
            }
        });

        // Admin Approve ticket
        app.patch('/tickets/:id/approve', async (req, res) => {
            try {
                const { id } = req.params;
                if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid ticket ID' });

                const ticket = await ticketsCollection.findOne({ _id: new ObjectId(id) });
                if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
                if (ticket.status === 'approved') return res.status(400).json({ message: 'Already approved' });

                await ticketsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'approved' } });
                res.json({ message: 'Ticket approved' });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: 'Failed to approve ticket' });
            }
        });

        //Admin  Reject ticket
        app.patch('/tickets/:id/reject', async (req, res) => {
            try {
                const { id } = req.params;
                if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid ticket ID' });

                const ticket = await ticketsCollection.findOne({ _id: new ObjectId(id) });
                if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
                if (ticket.status === 'rejected') return res.status(400).json({ message: 'Already rejected' });

                await ticketsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'rejected' } });
                res.json({ message: 'Ticket rejected' });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: 'Failed to reject ticket' });
            }
        });


        // Get bookings with optional status filter
        app.get('/bookings', async (req, res) => {
            try {
                const { status } = req.query;
                const filter = status
                    ? { status: { $regex: new RegExp(`^${status}$`, 'i') } } 
                    : {};

                const bookings = await bookingsCollection.find(filter).toArray();

                const detailedBookings = await Promise.all(
                    bookings.map(async (b) => {
                        const ticket = await ticketsCollection.findOne({ _id: new ObjectId(b.ticketId) });
                        const user = await usersCollection.findOne({ email: b.email });
                        return {
                            ...b,
                            ticket: ticket ? { ...ticket, _id: ticket._id.toString() } : null,
                            userName: user?.name || 'Unknown',
                            email: b.email || 'N/A',
                        };
                    })
                );

                res.json(detailedBookings);
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: 'Failed to fetch bookings' });
            }
        });

        // Vendor accept booking
        app.patch('/bookings/:id/accept', async (req, res) => {
            try {
                const { id } = req.params;
                const result = await bookingsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: 'accepted' } }
                );
                res.json({ message: 'Booking accepted', modifiedCount: result.modifiedCount });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: 'Failed to accept booking' });
            }
        });

        // Vendor reject booking
        app.patch('/bookings/:id/reject', async (req, res) => {
            try {
                const { id } = req.params;
                const result = await bookingsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: 'rejected' } }
                );
                res.json({ message: 'Booking rejected', modifiedCount: result.modifiedCount });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: 'Failed to reject booking' });
            }
        });



        app.get("/bookings", async (req, res) => {
            const { ticketId, status } = req.query;

            const query = {};
            if (ticketId) query.ticketId = new ObjectId(ticketId);
            if (status) query.status = status;

            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings);
        });


        // Update booking status 

        app.patch("/bookings/:id/status", async (req, res) => {
            try {
                const { id } = req.params;
                const { status } = req.body;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ message: "Invalid booking ID" });
                }

                if (!["pending", "approved", "rejected"].includes(status)) {
                    return res.status(400).json({ message: "Invalid status value" });
                }

                const result = await bookingsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ message: "Booking not found" });
                }

                res.json({ success: true, status });
            } catch (error) {
                console.error(error);
                res.status(500).json({ message: "Failed to update booking status" });
            }
        });


        app.patch('/tickets/:id/advertise', async (req, res) => {
            try {
                const { id } = req.params;
                const { advertise } = req.body;

                if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid ticket ID" });

                const result = await ticketsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { advertise } }
                );

                if (result.matchedCount === 0) return res.status(404).json({ message: "Ticket not found" });

                res.json({ message: `Ticket advertise set to ${advertise}` });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to update advertise status" });
            }
        });


        // Transactions for a user
        app.get('/transactions', async (req, res) => {
            try {
                const { email } = req.query;

                const query = email ? { userEmail: email } : {};
                const bookings = await bookingsCollection.find(query).toArray();

                const transactions = await Promise.all(
                    bookings.map(async (b) => {
                        let ticket = null;
                        if (b.ticketId && ObjectId.isValid(b.ticketId)) {
                            ticket = await ticketsCollection.findOne({ _id: new ObjectId(b.ticketId) });
                        }
                        return {
                            id: b._id.toString(),
                            amount: b.quantity * (b.unitPrice || ticket?.price || 0),
                            ticketTitle: ticket?.title || 'Unknown Ticket',
                            paymentDate: b.createdAt || new Date(),
                            status: b.status || 'pending',
                        };
                    })
                );

                res.json(transactions);
            } catch (err) {
                console.error('Transactions fetch error:', err);
                res.status(500).json({ message: 'Failed to fetch transactions' });
            }
        });



        // Get bookings 
        app.get('/bookings', async (req, res) => {
            try {
                const { ticketId, vendorEmail, status } = req.query;
                const query = {};

                if (ticketId) query.ticketId = new ObjectId(ticketId);
                if (status) query.status = status;

                let bookings = await bookingsCollection.find(query).toArray();

                if (vendorEmail) {
                    const vendorTickets = await ticketsCollection.find({ vendorEmail }).toArray();
                    const vendorTicketIds = vendorTickets.map(t => t._id.toString());
                    bookings = bookings.filter(b => vendorTicketIds.includes(b.ticketId.toString()));
                }

                const detailedBookings = await Promise.all(
                    bookings.map(async (b) => {
                        const ticket = await ticketsCollection.findOne({ _id: new ObjectId(b.ticketId) });
                        return {
                            ...b,
                            _id: b._id.toString(),
                            ticketTitle: ticket?.title || "Unknown Ticket",
                            unitPrice: ticket?.price || 0,
                            userEmail: b.email,
                        };
                    })
                );

                res.json(detailedBookings);
            } catch (err) {
                console.error("Fetch bookings error:", err);
                res.status(500).json({ message: "Failed to fetch bookings" });
            }
        });


        app.patch('/my-tickets/:id/pay', async (req, res) => {
            try {
                const { id } = req.params;
                if (!id) return res.status(400).json({ message: 'Booking ID is required' });

                const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
                if (!booking) return res.status(404).json({ message: 'Booking not found' });

                const departure = new Date(booking.departure);
                if (departure < new Date()) {
                    return res.status(400).json({ message: 'Cannot pay for a booking with passed departure.' });
                }

                const ticket = await ticketsCollection.findOne({ _id: new ObjectId(booking.ticketId) });
                if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

                if ((ticket.quantity || 0) < booking.quantity) {
                    return res.status(400).json({ message: 'Not enough tickets available.' });
                }

                await bookingsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: 'paid', paidAt: new Date() } }
                );

                await ticketsCollection.updateOne(
                    { _id: new ObjectId(booking.ticketId) },
                    { $inc: { quantity: -booking.quantity } }
                );

                res.json({ message: 'Payment successful', bookingId: id });
            } catch (err) {
                console.error('Pay booking error:', err);
                res.status(500).json({ message: 'Failed to process payment' });
            }
        });



        //bookings/:id/status
        app.patch('/bookings/:id/status', async (req, res) => {
            try {
                const { id } = req.params;
                const { status } = req.body;

                if (!id) return res.status(400).json({ message: "Booking ID is required" });
                if (!["accepted", "rejected"].includes(status)) {
                    return res.status(400).json({ message: "Status must be 'accepted' or 'rejected'" });
                }

                const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
                if (!booking) return res.status(404).json({ message: "Booking not found" });

                await bookingsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status } }
                );

                res.json({ message: `Booking ${status}` });
            } catch (err) {
                console.error("Booking status update error:", err);
                res.status(500).json({ message: "Failed to update booking status" });
            }
        });



        app.get('/vendor-bookings/:vendorEmail', async (req, res) => {
            try {
                const { vendorEmail } = req.params;
                if (!vendorEmail) return res.status(400).json({ message: "Vendor email is required" });

                const bookings = await bookingsCollection.find({ vendorEmail }).toArray();

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
                console.error(err);
                res.status(500).json({ message: "Failed to fetch vendor bookings" });
            }
        });

        // Delete a booking by its ID
        app.delete('/my-tickets/:id', async (req, res) => {
            try {
                const { id } = req.params;
                if (!id) return res.status(400).json({ message: 'Booking ID is required' });

                const result = await bookingsCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 0) {
                    return res.status(404).json({ message: 'Booking not found' });
                }

                res.status(200).json({ message: 'Booking deleted successfully' });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: 'Failed to delete booking' });
            }
        });


        console.log(" MongoDB server is connected")
    } catch (err) {
        console.error("MongoDB Error:", err);
    }
}

run();

app.listen(port, () => {
    console.log(`BOOKMYSEAT Server listening on port ${port}`);
});

