import { randomBytes } from "node:crypto";

async function testViaFrontend() {
  const payload = {
    event: "order_created",
    source: "website",
    name: "Via Frontend",
    phone: "212712345678",
    items: [
      { slug: "restwave", qty: 2 }
    ]
  };

  try {
    // Via frontend proxy
    const res = await fetch("http://localhost:3000/api/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    console.log("Frontend proxy status:", res.status);
    console.log("Frontend proxy response:", text);
  } catch (e) {
    console.error("Error:", e);
  }
}

testViaFrontend();
