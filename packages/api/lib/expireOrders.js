const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Expires unpaid orders past their deadline and returns their reserved stock.
// Each order is handled in its own transaction, so one failure doesn't stop the others.
async function expireOverdueOrders(now = new Date()) {
  const overdue = await prisma.order.findMany({
    where: { status: "PENDING_PAYMENT", expiresAt: { lt: now } },
    include: { subOrders: { include: { items: true } } },
  });

  let expired = 0;
  for (const order of overdue) {
    try {
      await prisma.$transaction(async (tx) => {
        // Re-check inside the transaction, in case the order was paid or cancelled meanwhile
        const current = await tx.order.findUnique({ where: { id: order.id } });
        if (!current || current.status !== "PENDING_PAYMENT") return;

        for (const sub of order.subOrders) {
          for (const item of sub.items) {
            await tx.product.update({
              where: { id: item.productId },
              data: { quantity: { increment: item.quantity } },
            });
          }
          await tx.subOrder.update({ where: { id: sub.id }, data: { status: "EXPIRED" } });
        }
        await tx.order.update({ where: { id: order.id }, data: { status: "EXPIRED" } });
        expired++;
      });
    } catch (err) {
      console.error(`Could not expire order ${order.id}:`, err);
    }
  }
  return expired;
}

module.exports = { expireOverdueOrders };
