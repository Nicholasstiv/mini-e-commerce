import * as bcrypt from 'bcrypt';
import { AppDataSource } from './data-source';

const USERS = 500;
const PRODUCTS = 200;
const ORDERS = 50_000;

async function main() {
  await AppDataSource.initialize();
  const started = Date.now();

  console.log('Limpando seed anterior...');
  await AppDataSource.query(
    `DELETE FROM "order" WHERE "userId" IN (
       SELECT id FROM "user" WHERE email LIKE 'seed%@example.com')`,
  );
  await AppDataSource.query(
    `DELETE FROM "user" WHERE email LIKE 'seed%@example.com'`,
  );
  await AppDataSource.query(
    `DELETE FROM product WHERE name LIKE 'Seed Product %'`,
  );

  console.log(`Criando ${USERS} usuários...`);
  const hash = await bcrypt.hash('seedpass123', 10);
  await AppDataSource.query(
    `INSERT INTO "user" (email, password)
     SELECT 'seed' || g || '@example.com', $1
     FROM generate_series(1, $2::int) AS g`,
    [hash, USERS],
  );

  console.log(`Criando ${PRODUCTS} produtos...`);
  await AppDataSource.query(
    `INSERT INTO product (name, "priceCents", stock)
     SELECT 'Seed Product ' || g,
            (500 + random() * 50000)::int,
            1000000
     FROM generate_series(1, $1::int) AS g`,
    [PRODUCTS],
  );

  console.log(`Criando ${ORDERS} pedidos e itens...`);
  await AppDataSource.query(
    `WITH u AS MATERIALIZED (
       SELECT id, row_number() OVER (ORDER BY email) AS rn
       FROM "user" WHERE email LIKE 'seed%@example.com'
     ),
     p AS MATERIALIZED (
       SELECT id, "priceCents", row_number() OVER (ORDER BY name) AS rn
       FROM product WHERE name LIKE 'Seed Product %'
     ),
     -- random()^3 concentra os pedidos nos primeiros usuários (distribuição desigual)
     picks AS MATERIALIZED (
       SELECT g,
              1 + floor($1::int * power(random(), 3))::int AS rn,
              random() AS r_status,
              random() AS r_date
       FROM generate_series(1, $2::int) AS g
     ),
     new_orders AS (
       INSERT INTO "order" ("userId", status, "totalCents", "createdAt", "updatedAt")
       SELECT u.id,
              (CASE WHEN picks.r_status < 0.70 THEN 'paid'
                    WHEN picks.r_status < 0.90 THEN 'pending'
                    ELSE 'cancelled' END)::"public"."order_status_enum",
              0,
              now() - picks.r_date * interval '365 days',
              now()
       FROM picks JOIN u ON u.rn = picks.rn
       RETURNING id
     ),
     numbered AS (
       SELECT id, row_number() OVER () AS n FROM new_orders
     )
     INSERT INTO order_item ("orderId", "productId", quantity, "unitPriceCents")
     SELECT o.id, p.id, 1 + floor(random() * 3)::int, p."priceCents"
     FROM numbered o
     CROSS JOIN generate_series(1, 3) AS k
     -- produtos distintos dentro do mesmo pedido: (n + k*37) mod PRODUCTS
     JOIN p ON p.rn = ((o.n + k * 37) % $3::int) + 1
     WHERE k <= 1 + (o.n % 3)`,
    [USERS, ORDERS, PRODUCTS],
  );

  console.log('Calculando totais dos pedidos...');
  await AppDataSource.query(
    `UPDATE "order" o
     SET "totalCents" = s.total
     FROM (
       SELECT "orderId", SUM(quantity * "unitPriceCents")::int AS total
       FROM order_item GROUP BY "orderId"
     ) s
     WHERE s."orderId" = o.id AND o."totalCents" = 0`,
  );

  console.log('Atualizando estatísticas (ANALYZE)...');
  await AppDataSource.query(`ANALYZE "order"`);
  await AppDataSource.query(`ANALYZE order_item`);
  await AppDataSource.query(`ANALYZE "user"`);
  await AppDataSource.query(`ANALYZE product`);

  const [{ orders }] = await AppDataSource.query(
    `SELECT count(*)::int AS orders FROM "order"`,
  );
  const [{ items }] = await AppDataSource.query(
    `SELECT count(*)::int AS items FROM order_item`,
  );
  console.log(
    `Pronto em ${((Date.now() - started) / 1000).toFixed(1)}s. ` +
      `Pedidos na tabela: ${orders}, itens: ${items}.`,
  );

  await AppDataSource.destroy();
}

main().catch(async (err) => {
  console.error(err);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
