/**
 * Depósito cuyo stock NO es de Ventaz ("Productazos"): esa mercadería no se puede vender, así
 * que sus unidades no cuentan como disponibles en ningún lado (catálogo, tienda, job de stock de
 * Mercado Libre). Se resta del total de `stock` en cada consulta — ver stockCounts().
 * STOCK_EXCLUDED_WAREHOUSE_ID permite cambiarlo sin tocar código; si no es un UUID válido se
 * ignora y queda el de Productazos.
 */
const PRODUCTAZOS_WAREHOUSE_ID = "c9b84e1c-b97f-474b-b50c-484bef1fb292";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EXCLUDED_WAREHOUSE_ID = UUID_RE.test(process.env.STOCK_EXCLUDED_WAREHOUSE_ID || "")
  ? process.env.STOCK_EXCLUDED_WAREHOUSE_ID
  : PRODUCTAZOS_WAREHOUSE_ID;

// SQL fragment para el WHERE de un subquery sobre `stock`, con el alias de la tabla:
//   `SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.id AND ${stockCounts("s")}`
// IS DISTINCT FROM (y no <>) para que una fila con warehouse_id NULL siga contando.
export const stockCounts = (alias) =>
  `${alias}.warehouse_id IS DISTINCT FROM '${EXCLUDED_WAREHOUSE_ID}'::uuid`;
