import { randomBytes } from "node:crypto";

async function testOrder() {
  const payload = {
    event: "order_created",
    source: "website",
    name: "Test User",
    phone: "212612345678",
    items: [
      { slug: "vitalstride", qty: 1 }
    ]
  };

  try {
    const res = await fetch("http://localhost:4000/api/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log("Status:", res.status);
    console.log("Response:", JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}

testOrder();
