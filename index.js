require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
    origin: [
        "http://localhost:5173",
        "https://book-my-seat-77125.web.app",
        "https://book-my-seat-77125.firebaseapp.com",
    ],
    credentials: true,
}));
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: ServerApiVersion.v1,
});

let users, tickets, bookings, vendorRequests;

async function run() {
    try {
        // await client.connect();
        const db = client.db("bookmyseat-DB");

        users = db.collection("users");
        tickets = db.collection("tickets");
        bookings = db.collection("bookings");
        vendorRequests = db.collection("vendorRequests");

        console.log("MongoDB connected");

        app.get("/", (req, res) => {
            res.send("BOOKMYSEAT server running");
        });

        // Get all users (Admin use)
        app.get("/users", async (req, res) => {
            try {
                const result = await users.find().toArray();
                res.json(
                    result.map(u => ({
                        ...u,
                        _id: u._id.toString(),
                    }))
                );
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to fetch users" });
            }
        });


        // Get user role by email
        app.get("/user/role", async (req, res) => {
            try {
                const { email } = req.query;

                if (!email) {
                    return res
                        .status(400)
                        .json({ role: "user" });
                }

                const user = await users.findOne({ email });

                res.setHeader("Content-Type", "application/json");
                res.json({ role: user?.role || "user" });
            } catch (err) {
                console.error("Role fetch error:", err);
                res
                    .status(500)
                    .json({ role: "user" });
            }
        });



        // Create user (on first login)
        app.post("/users", async (req, res) => {
            try {
                const { email, name } = req.body;

                if (!email) {
                    return res.status(400).json({ message: "Email required" });
                }

                const exists = await users.findOne({ email });
                if (exists) {
                    return res.json({
                        message: "User already exists",
                        role: exists.role,
                    });
                }

                const newUser = {
                    email,
                    name: name || email.split("@")[0],
                    role: "user",
                    createdAt: new Date(),
                };

                const result = await users.insertOne(newUser);

                res.status(201).json({
                    insertedId: result.insertedId,
                    role: "user",
                });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to create user" });
            }
        });


        // Get single user profile
        app.get("/users/profile", async (req, res) => {
            try {
                const { email } = req.query;
                if (!email) {
                    return res.status(400).json({ message: "Email required" });
                }

                const user = await users.findOne({ email });
                if (!user) {
                    return res.status(404).json({ message: "User not found" });
                }

                res.json({
                    _id: user._id.toString(),
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    createdAt: user.createdAt,
                });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to fetch profile" });
            }
        });


        // Update user role (Admin)
        app.patch("/users/:id/role", async (req, res) => {
            try {
                const { id } = req.params;
                const { role } = req.body;

                if (!["user", "admin", "vendor"].includes(role)) {
                    return res.status(400).json({ message: "Invalid role" });
                }

                await users.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role } }
                );

                res.json({ success: true });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to update role" });
            }
        });


        // Delete user (optional – admin)
        app.delete("/users/:id", async (req, res) => {
            try {
                const { id } = req.params;

                await users.deleteOne({ _id: new ObjectId(id) });
                res.json({ success: true });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to delete user" });
            }
        });



        /*  TICKETS */
        app.get("/tickets", async (req, res) => {
            try {
                const {
                    search = "",
                    category,
                    minPrice,
                    maxPrice,
                    advertise,
                    status,
                    sortBy = "price",
                    order = "asc",
                } = req.query;

                // Build MongoDB query
                const query = {
                    title: { $regex: search, $options: "i" },
                };

                if (category) query.category = category; // filter by category

                if (minPrice || maxPrice) {
                    query.price = {};
                    if (minPrice) query.price.$gte = Number(minPrice);
                    if (maxPrice) query.price.$lte = Number(maxPrice);
                }

                if (advertise === "true") query.advertise = true;
                if (status) query.status = status;

                const result = await tickets
                    .find(query)
                    .sort({ [sortBy]: order === "desc" ? -1 : 1 })
                    .toArray();

                res.json(result.map(t => ({ ...t, _id: t._id.toString() })));
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to fetch tickets" });
            }
        });



        app.get("/tickets/:id", async (req, res) => {
            const ticket = await tickets.findOne({ _id: new ObjectId(req.params.id) });
            if (!ticket) return res.status(404).json({ message: "Ticket not found" });
            res.json({ ...ticket, _id: ticket._id.toString() });
        });

        app.post("/tickets", async (req, res) => {
            const newTicket = {
                ...req.body,
                price: Number(req.body.price),
                quantity: Number(req.body.quantity),
                status: "pending",
                advertise: false,
                createdAt: new Date(),
            };

            const result = await tickets.insertOne(newTicket);
            res.json({ ticketId: result.insertedId });
        });

        app.patch("/tickets/:id/advertise", async (req, res) => {
            await tickets.updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { advertise: req.body.advertise } }
            );
            res.json({ success: true });
        });

        app.delete("/tickets/:id", async (req, res) => {
            await tickets.deleteOne({ _id: new ObjectId(req.params.id) });
            res.json({ success: true });
        });

        app.get("/my-tickets", async (req, res) => {
            try {
                const { email } = req.query;
                if (!email) {
                    return res.status(400).json({ message: "Email is required" });
                }

                const result = await bookings.find({ email }).toArray();

                const detailed = await Promise.all(
                    result.map(async b => {
                        const ticket = await tickets.findOne({ _id: new ObjectId(b.ticketId) });
                        return {
                            ...b,
                            _id: b._id.toString(),
                            ticket: ticket ? { ...ticket, _id: ticket._id.toString() } : null,
                        };
                    })
                );

                res.json(detailed);
            } catch (err) {
                res.status(500).json({ message: "Failed to fetch my tickets" });
            }
        });


        app.get("/my-added-tickets/:email", async (req, res) => {
            try {
                const { email } = req.params;

                const result = await tickets
                    .find({ vendorEmail: email })
                    .toArray();

                res.json(result.map(t => ({ ...t, _id: t._id.toString() })));
            } catch (err) {
                res.status(500).json({ message: "Failed to fetch vendor tickets" });
            }
        });



        //  BOOKINGS  

        app.get("/bookings", async (req, res) => {
            try {
                const { email, status } = req.query;

                const query = {};

                if (email) {
                    query.email = email;
                }

                if (status) {
                    query.status = { $regex: new RegExp(`^${status}$`, "i") };
                }

                const data = await bookings
                    .find(query)
                    .sort({ createdAt: -1 })
                    .toArray();

                const detailed = await Promise.all(
                    data.map(async (b) => {
                        const ticket = b.ticketId
                            ? await tickets.findOne({ _id: new ObjectId(b.ticketId) })
                            : null;

                        return {
                            _id: b._id.toString(),
                            email: b.email,
                            quantity: b.quantity,
                            status: b.status,
                            createdAt: b.createdAt,
                            ticket: ticket
                                ? {
                                    title: ticket.title,
                                    price: ticket.price,
                                }
                                : null,
                        };
                    })
                );

                res.json(detailed);
            } catch (err) {
                console.error("Fetch bookings error:", err);
                res.status(500).json({ message: "Failed to fetch bookings" });
            }
        });



        app.post("/bookings", async (req, res) => {
            const booking = {
                ...req.body,
                email: req.body.email,
                status: "pending",
                createdAt: new Date(),
            };

            const result = await bookings.insertOne(booking);
            res.json({ bookingId: result.insertedId });
        });


        app.patch("/bookings/:id/status", async (req, res) => {
            const { status } = req.body;
            if (!["pending", "approved", "rejected"].includes(status)) {
                return res.status(400).json({ message: "Invalid status" });
            }

            await bookings.updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { status } }
            );
            res.json({ success: true });
        });

        app.delete("/my-tickets/:id", async (req, res) => {
            await bookings.deleteOne({ _id: new ObjectId(req.params.id) });
            res.json({ success: true });
        });


        // Transactions

        app.get("/transactions", async (req, res) => {
            try {
                const { email } = req.query;
                if (!email) return res.json([]);

                const userBookings = await bookings
                    .find({ email })
                    .sort({ createdAt: -1 })
                    .toArray();

                const transactions = await Promise.all(
                    userBookings.map(async (b) => {
                        let ticket = null;
                        if (b.ticketId) {
                            try {
                                ticket = await tickets.findOne({
                                    _id: new ObjectId(b.ticketId),
                                });
                            } catch {
                                ticket = null;
                            }
                        }

                        return {
                            id: b._id.toString(),
                            amount: (b.quantity || 0) * (ticket?.price || 0),
                            ticketTitle: ticket?.title || "Unknown Ticket",
                            paymentDate: b.paidAt || b.createdAt,
                            status: b.status || "pending",
                        };
                    })
                );

                res.json(transactions);
            } catch (err) {
                console.error("Transaction fetch error:", err);
                res.status(500).json({ message: "Transaction fetch failed" });
            }
        });


        // ADMIN

        app.get("/admin/bookings", async (req, res) => {
            try {
                const data = await bookings.find().toArray();

                const detailed = await Promise.all(
                    data.map(async (b) => {
                        const ticket = await tickets.findOne({
                            _id: new ObjectId(b.ticketId),
                        });

                        return {
                            _id: b._id.toString(),
                            email: b.email,
                            quantity: b.quantity,
                            status: b.status,
                            createdAt: b.createdAt,
                            ticket: ticket
                                ? {
                                    title: ticket.title,
                                    price: ticket.price,
                                }
                                : null,
                        };
                    })
                );

                res.json(detailed);
            } catch (err) {
                console.error(err);
                res.status(500).json([]);
            }
        });

        // Admin approve ticket
        app.patch("/tickets/:id/approve", async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ message: "Invalid ticket id" });
                }

                const result = await tickets.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "approved" } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ message: "Ticket not found" });
                }

                res.json({ success: true });
            } catch (err) {
                console.error("Approve ticket error:", err);
                res.status(500).json({ message: "Failed to approve ticket" });
            }
        });

        // Admin reject ticket
        app.patch("/tickets/:id/reject", async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ message: "Invalid ticket id" });
                }

                const result = await tickets.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "rejected" } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ message: "Ticket not found" });
                }

                res.json({ success: true });
            } catch (err) {
                console.error("Reject ticket error:", err);
                res.status(500).json({ message: "Failed to reject ticket" });
            }
        });



        // VENDOR
        //  REVENUE OVERVIEW 
        app.get("/revenue-overview/:vendorEmail", async (req, res) => {
            try {
                const { vendorEmail } = req.params;

                if (!vendorEmail) {
                    return res.status(400).json({
                        totalTicketsAdded: 0,
                        totalTicketsSold: 0,
                        totalRevenue: 0,
                    });
                }

                // Tickets added by vendor
                const vendorTickets = await tickets.find({ vendorEmail }).toArray();

                const totalTicketsAdded = vendorTickets.reduce(
                    (sum, t) => sum + (t.quantity || 0),
                    0
                );

                // Bookings for vendor tickets
                const ticketIds = vendorTickets.map(t => t._id.toString());

                const vendorBookings = await bookings.find({
                    ticketId: { $in: ticketIds },
                    status: { $in: ["approved", "paid"] },
                }).toArray();

                const totalTicketsSold = vendorBookings.reduce(
                    (sum, b) => sum + (b.quantity || 0),
                    0
                );

                const totalRevenue = vendorBookings.reduce((sum, b) => {
                    const ticket = vendorTickets.find(
                        t => t._id.toString() === b.ticketId
                    );
                    return sum + (b.quantity || 0) * (ticket?.price || 0);
                }, 0);

                res.json({
                    totalTicketsAdded,
                    totalTicketsSold,
                    totalRevenue,
                });
            } catch (err) {
                console.error("Revenue overview error:", err);
                res.status(500).json({
                    totalTicketsAdded: 0,
                    totalTicketsSold: 0,
                    totalRevenue: 0,
                });
            }
        });

        // Inside fetchTickets
        const res = await fetch(
            `https://book-my-seat-server.vercel.app/tickets?${queryParams}`
        );
        const data = await res.json();

        const ticketsData = Array.isArray(data) ? data : data.tickets || [];

        if (page === 1) {
            setTickets(ticketsData);
        } else {
            setTickets((prev) => [...prev, ...ticketsData]);
        }

        setHasMore(ticketsData.length === 8);


        // Vendor statistics 
        app.get("/vendor/statistics/:email", async (req, res) => {
            try {
                const { email } = req.params;

                const vendorTickets = await tickets.find({ vendorEmail: email }).toArray();
                const ticketIds = vendorTickets.map(t => t._id.toString());

                const vendorBookings = await bookings.find({
                    ticketId: { $in: ticketIds },
                    status: { $in: ["approved", "paid"] }
                }).toArray();

                const totalTicketsAdded = vendorTickets.reduce(
                    (sum, t) => sum + (t.quantity || 0),
                    0
                );

                const totalTicketsSold = vendorBookings.reduce(
                    (sum, b) => sum + (b.quantity || 0),
                    0
                );

                const totalRevenue = vendorBookings.reduce((sum, b) => {
                    const ticket = vendorTickets.find(t => t._id.toString() === b.ticketId);
                    return sum + (b.quantity || 0) * (ticket?.price || 0);
                }, 0);

                res.json({
                    totalTicketsAdded,
                    totalTicketsSold,
                    totalRevenue
                });
            } catch (err) {
                console.error(err);
                res.status(500).json({
                    totalTicketsAdded: 0,
                    totalTicketsSold: 0,
                    totalRevenue: 0
                });
            }
        });





    } catch (err) {
        console.error(err);
    }
}

run();

app.listen(port, () => {
    console.log(` Server running on port ${port}`);
});
