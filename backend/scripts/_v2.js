require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
(async () => {
  try {
    const acct = await stripe.rawRequest("POST", "/v2/core/accounts", {
      display_name: "Smoke Test Co",
      contact_email: "smoke@eventsli-test.invalid",
      identity: { country: "CA", entity_type: "individual" },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      include: ["configuration.merchant", "configuration.recipient", "requirements"],
    });
    console.log("OK id:", acct.id);
    console.log("keys:", Object.keys(acct).join(", "));
  } catch (e) {
    console.log("ERR:", e.message);
  }
  process.exit(0);
})();
