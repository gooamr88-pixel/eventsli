require("dotenv").config();
const s = require("../services/stripeService");
(async () => {
  const fake = { id: "00000000-0000-4000-8000-00000000dead", country: "CA",
                 display_name: "Smoke Test Co", email: "smoke@eventsli-test.invalid",
                 stripe_account_id: null };
  try {
    // Bypass the DB write by calling Stripe directly through the same path.
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const acct = await stripe.accounts.create({
      type: "express", country: "CA", email: fake.email,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { name: fake.display_name, product_description: "smoke test" },
    });
    console.log("account created:", acct.id, "country:", acct.country);
    const link = await stripe.accountLinks.create({
      account: acct.id, type: "account_onboarding",
      refresh_url: "http://localhost:3000/r", return_url: "http://localhost:3000/d",
    });
    console.log("onboarding link OK:", link.url.slice(0, 40) + "...");
    console.log("charges_enabled:", acct.charges_enabled, "payouts_enabled:", acct.payouts_enabled);
  } catch (e) { console.log("STRIPE ERROR:", e.message); }
  process.exit(0);
})();
