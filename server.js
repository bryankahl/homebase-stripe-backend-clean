// server.js

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import stripeModule from "stripe";
import { admin, db } from "./firebase-admin.js";

dotenv.config();
const stripe = stripeModule(process.env.STRIPE_SECRET_KEY);
const app = express();
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// ✅ CORS middleware (FIRST!)
const allowedOrigins = ["https://ai-agent-demo-9fe52.web.app"];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ✅ Raw body parser ONLY for Stripe webhook
app.post("/webhook", bodyParser.raw({ type: "application/json" }));

// ✅ JSON parser for everything else
app.use(bodyParser.json());

// ✅ Health check
app.get("/", (req, res) => {
  res.send("🔥 Homebase AI backend is running.");
});

// ✅ Create Stripe checkout session
app.post("/create-checkout-session", async (req, res) => {
  const idToken = req.headers.authorization?.split("Bearer ")[1];
  if (!idToken) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      customer_email: email,
      metadata: { uid },
      success_url: process.env.SUCCESS_URL,
      cancel_url: process.env.CANCEL_URL,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Auth or Stripe error:", err);
    res.status(401).json({ error: "Unauthorized" });
  }
});

// ✅ Stripe webhook route
app.post("/webhook", (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("⚠️ Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const uid = session.metadata.uid;

    db.collection("businesses")
      .doc(uid)
      .set({ isActive: true }, { merge: true })
      .then(() => console.log(`✅ Activated user ${uid}`))
      .catch(err => console.error(`❌ Failed to activate user ${uid}`, err));
  }

  res.status(200).send("OK");
});

// ✅ Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
