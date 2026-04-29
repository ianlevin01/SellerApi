--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.5

-- Started on 2026-04-29 01:11:28

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 2 (class 3079 OID 16483)
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- TOC entry 4843 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- TOC entry 3 (class 3079 OID 16900)
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- TOC entry 4844 (class 0 OID 0)
-- Dependencies: 3
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 231 (class 1259 OID 16662)
-- Name: cash_movements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cash_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    source text,
    reference_id uuid,
    amount numeric(12,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    divisa text DEFAULT 'ARS'::text NOT NULL,
    warehouse_id uuid,
    negocio_id uuid NOT NULL,
    CONSTRAINT cash_movements_divisa_check CHECK ((divisa = ANY (ARRAY['ARS'::text, 'USD'::text])))
);


ALTER TABLE public.cash_movements OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 16540)
-- Name: categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    negocio_id uuid NOT NULL
);


ALTER TABLE public.categories OWNER TO postgres;

--
-- TOC entry 238 (class 1259 OID 17054)
-- Name: cc_movimientos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cc_movimientos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cuenta_corriente_id uuid NOT NULL,
    tipo text NOT NULL,
    concepto text,
    monto numeric(12,2) NOT NULL,
    order_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    metodo_pago text DEFAULT 'Efectivo'::text,
    divisa_cuenta text DEFAULT 'ARS'::text NOT NULL,
    divisa_cobro text DEFAULT 'ARS'::text NOT NULL,
    monto_original numeric(12,2),
    cotizacion_usada numeric(12,4),
    warehouse_id uuid,
    CONSTRAINT cc_movimientos_tipo_check CHECK ((tipo = ANY (ARRAY['debito'::text, 'pago'::text])))
);


ALTER TABLE public.cc_movimientos OWNER TO postgres;

--
-- TOC entry 245 (class 1259 OID 17673)
-- Name: cc_movimientos_prov; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cc_movimientos_prov (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cuenta_corriente_id uuid NOT NULL,
    tipo text NOT NULL,
    concepto text,
    monto numeric(12,2) NOT NULL,
    order_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    metodo_pago text DEFAULT 'Efectivo'::text,
    divisa_cuenta text DEFAULT 'ARS'::text NOT NULL,
    divisa_cobro text DEFAULT 'ARS'::text NOT NULL,
    monto_original numeric(12,2),
    cotizacion_usada numeric(12,4),
    CONSTRAINT cc_movimientos_prov_tipo_check CHECK ((tipo = ANY (ARRAY['debito'::text, 'pago'::text])))
);


ALTER TABLE public.cc_movimientos_prov OWNER TO postgres;

--
-- TOC entry 254 (class 1259 OID 18682)
-- Name: conversations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.conversations (
    id integer NOT NULL,
    seller_id uuid NOT NULL,
    customer_name character varying(100) NOT NULL,
    customer_email character varying(200),
    customer_phone character varying(30),
    access_token character varying(64) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.conversations OWNER TO postgres;

--
-- TOC entry 253 (class 1259 OID 18681)
-- Name: conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.conversations_id_seq OWNER TO postgres;

--
-- TOC entry 4845 (class 0 OID 0)
-- Dependencies: 253
-- Name: conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.conversations_id_seq OWNED BY public.conversations.id;


--
-- TOC entry 237 (class 1259 OID 17038)
-- Name: cuentas_corrientes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cuentas_corrientes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    saldo numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    divisa text DEFAULT 'ARS'::text NOT NULL,
    CONSTRAINT cuentas_corrientes_divisa_check CHECK ((divisa = ANY (ARRAY['ARS'::text, 'USD'::text])))
);


ALTER TABLE public.cuentas_corrientes OWNER TO postgres;

--
-- TOC entry 244 (class 1259 OID 17659)
-- Name: cuentas_corrientes_prov; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cuentas_corrientes_prov (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    proveedor_id uuid NOT NULL,
    saldo numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    divisa text DEFAULT 'ARS'::text NOT NULL,
    CONSTRAINT cuentas_corrientes_prov_divisa_check CHECK ((divisa = ANY (ARRAY['ARS'::text, 'USD'::text])))
);


ALTER TABLE public.cuentas_corrientes_prov OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 16531)
-- Name: customers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text,
    document text,
    phone text,
    email text,
    created_at timestamp without time zone DEFAULT now(),
    domicilio text,
    localidad text,
    provincia text,
    codigo_postal text,
    contacto text,
    descuento numeric(5,2),
    dias_plazo integer,
    transporte text,
    condicion_iva text,
    vendedor text,
    cuenta_pesos text,
    cuenta_dolares text,
    codigo text,
    divisa text DEFAULT 'ARS'::text NOT NULL,
    negocio_id uuid,
    CONSTRAINT customers_divisa_check CHECK ((divisa = ANY (ARRAY['ARS'::text, 'USD'::text])))
);


ALTER TABLE public.customers OWNER TO postgres;

--
-- TOC entry 242 (class 1259 OID 17622)
-- Name: favorites; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.favorites OWNER TO postgres;

--
-- TOC entry 256 (class 1259 OID 18698)
-- Name: messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    sender character varying(10) NOT NULL,
    body text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    read_at timestamp without time zone,
    msg_type character varying(20) DEFAULT 'text'::character varying NOT NULL,
    quote_data jsonb,
    CONSTRAINT messages_sender_check CHECK (((sender)::text = ANY ((ARRAY['customer'::character varying, 'seller'::character varying])::text[])))
);


ALTER TABLE public.messages OWNER TO postgres;

--
-- TOC entry 255 (class 1259 OID 18697)
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.messages_id_seq OWNER TO postgres;

--
-- TOC entry 4846 (class 0 OID 0)
-- Dependencies: 255
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- TOC entry 262 (class 1259 OID 19305)
-- Name: negocios; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.negocios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    razon_social text,
    cuit text,
    domicilio text,
    logo_key text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.negocios OWNER TO postgres;

--
-- TOC entry 229 (class 1259 OID 16632)
-- Name: order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    cost numeric(12,2)
);


ALTER TABLE public.order_items OWNER TO postgres;

--
-- TOC entry 263 (class 1259 OID 19416)
-- Name: order_shipping; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_shipping (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    web_order_id uuid,
    shipping_type character varying(20),
    postal_code character varying(10),
    province character varying(100),
    street character varying(255),
    street_number character varying(30),
    floor_apt character varying(50),
    city character varying(100),
    branch_id character varying(50),
    branch_name character varying(255),
    service_code character varying(50),
    service_name character varying(100),
    shipping_amount numeric DEFAULT 0,
    tracking_code character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.order_shipping OWNER TO postgres;

--
-- TOC entry 228 (class 1259 OID 16612)
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid,
    user_id uuid,
    total numeric(12,2),
    profit numeric(12,2),
    status text DEFAULT 'pending'::text,
    created_at timestamp without time zone DEFAULT now(),
    tipo text DEFAULT 'Presupuesto'::text,
    vendedor text,
    price_type text DEFAULT 'precio_1'::text,
    texto_libre text,
    escenario text,
    origen text,
    destino text,
    customer_id_remito uuid,
    supplier_id uuid,
    warehouse_id uuid,
    es_consumidor_final boolean DEFAULT false,
    consumidor_final_nombre text,
    divisa text DEFAULT 'ARS'::text,
    negocio_id uuid NOT NULL,
    recipient_user_id uuid
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- TOC entry 230 (class 1259 OID 16648)
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    method text NOT NULL,
    amount numeric(12,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.payments OWNER TO postgres;

--
-- TOC entry 240 (class 1259 OID 17575)
-- Name: price_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.price_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cotizacion_dolar numeric(12,4) DEFAULT 1000 NOT NULL,
    pct_1 numeric(8,4) DEFAULT 0 NOT NULL,
    pct_2 numeric(8,4) DEFAULT 0 NOT NULL,
    pct_3 numeric(8,4) DEFAULT 0 NOT NULL,
    pct_4 numeric(8,4) DEFAULT 0 NOT NULL,
    pct_5 numeric(8,4) DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now(),
    negocio_id uuid NOT NULL
);


ALTER TABLE public.price_config OWNER TO postgres;

--
-- TOC entry 232 (class 1259 OID 16671)
-- Name: product_costs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    cost numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.product_costs OWNER TO postgres;

--
-- TOC entry 236 (class 1259 OID 16952)
-- Name: product_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    key text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.product_images OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 16570)
-- Name: product_prices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    price_type text NOT NULL,
    currency text DEFAULT 'ARS'::text,
    price numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.product_prices OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 16553)
-- Name: products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text,
    barcode text,
    name text NOT NULL,
    description text,
    category_id uuid,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    box_code text,
    tasa_iva numeric(8,4),
    despacho text,
    aduana text,
    origen text,
    qxb integer,
    punto_pedido integer,
    video_url text,
    stock_reserva integer DEFAULT 0 NOT NULL,
    costo_usd numeric(12,4),
    negocio_id uuid NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.products OWNER TO postgres;

--
-- TOC entry 243 (class 1259 OID 17649)
-- Name: proveedores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.proveedores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text,
    document text,
    phone text,
    email text,
    created_at timestamp without time zone DEFAULT now(),
    domicilio text,
    localidad text,
    provincia text,
    codigo_postal text,
    contacto text,
    descuento numeric(5,2),
    dias_plazo integer,
    transporte text,
    condicion_iva text,
    vendedor text,
    cuenta_pesos text,
    cuenta_dolares text,
    codigo text,
    divisa text DEFAULT 'ARS'::text NOT NULL,
    negocio_id uuid NOT NULL,
    CONSTRAINT proveedores_divisa_check CHECK ((divisa = ANY (ARRAY['ARS'::text, 'USD'::text])))
);


ALTER TABLE public.proveedores OWNER TO postgres;

--
-- TOC entry 257 (class 1259 OID 18714)
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    ran_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO postgres;

--
-- TOC entry 261 (class 1259 OID 18770)
-- Name: seller_discount_tiers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_discount_tiers (
    id integer NOT NULL,
    seller_id uuid NOT NULL,
    threshold numeric(14,2) NOT NULL,
    discount_pct numeric(5,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    discount_type character varying(10) DEFAULT 'quantity'::character varying NOT NULL,
    page_id uuid
);


ALTER TABLE public.seller_discount_tiers OWNER TO postgres;

--
-- TOC entry 260 (class 1259 OID 18769)
-- Name: seller_discount_tiers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.seller_discount_tiers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.seller_discount_tiers_id_seq OWNER TO postgres;

--
-- TOC entry 4847 (class 0 OID 0)
-- Dependencies: 260
-- Name: seller_discount_tiers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.seller_discount_tiers_id_seq OWNED BY public.seller_discount_tiers.id;


--
-- TOC entry 259 (class 1259 OID 18751)
-- Name: seller_discounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_discounts (
    id integer NOT NULL,
    seller_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    discount_type character varying(10) DEFAULT 'quantity'::character varying NOT NULL,
    min_profit_pct numeric(5,2) DEFAULT 10 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    enabled_quantity boolean DEFAULT false NOT NULL,
    enabled_price boolean DEFAULT false NOT NULL,
    page_id uuid
);


ALTER TABLE public.seller_discounts OWNER TO postgres;

--
-- TOC entry 258 (class 1259 OID 18750)
-- Name: seller_discounts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.seller_discounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.seller_discounts_id_seq OWNER TO postgres;

--
-- TOC entry 4848 (class 0 OID 0)
-- Dependencies: 258
-- Name: seller_discounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.seller_discounts_id_seq OWNED BY public.seller_discounts.id;


--
-- TOC entry 249 (class 1259 OID 18595)
-- Name: seller_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    product_id uuid NOT NULL,
    key text NOT NULL,
    "order" integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    page_id uuid
);


ALTER TABLE public.seller_images OWNER TO postgres;

--
-- TOC entry 247 (class 1259 OID 18551)
-- Name: seller_pages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    slug text NOT NULL,
    store_name text,
    store_description text,
    banner_color text DEFAULT '#6366f1'::text,
    logo_key text,
    pct_markup numeric(8,4) DEFAULT 0,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    tagline character varying(160),
    whatsapp character varying(30),
    instagram character varying(60),
    facebook character varying(120),
    page_name character varying(80),
    logo_url character varying(500),
    font_family character varying(80),
    color_secondary character varying(7),
    color_bg character varying(7),
    color_text character varying(7),
    featured_categories jsonb,
    card_border_radius smallint DEFAULT 12,
    card_show_shadow boolean DEFAULT true
);


ALTER TABLE public.seller_pages OWNER TO postgres;

--
-- TOC entry 248 (class 1259 OID 18573)
-- Name: seller_products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seller_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    product_id uuid NOT NULL,
    active boolean DEFAULT true,
    custom_name text,
    custom_desc text,
    created_at timestamp without time zone DEFAULT now(),
    page_id uuid,
    custom_price numeric
);


ALTER TABLE public.seller_products OWNER TO postgres;

--
-- TOC entry 246 (class 1259 OID 18538)
-- Name: sellers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sellers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text,
    name text,
    phone text,
    verified boolean DEFAULT false,
    verify_token text,
    reset_token text,
    reset_expires timestamp without time zone,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    city character varying(100),
    age integer,
    how_found_us character varying(50),
    phone_verified boolean DEFAULT false,
    phone_otp character varying(6),
    phone_otp_expires_at timestamp without time zone,
    google_id text
);


ALTER TABLE public.sellers OWNER TO postgres;

--
-- TOC entry 241 (class 1259 OID 17611)
-- Name: shop_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shop_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    name text,
    created_at timestamp without time zone DEFAULT now(),
    customer_id uuid
);


ALTER TABLE public.shop_users OWNER TO postgres;

--
-- TOC entry 227 (class 1259 OID 16593)
-- Name: stock; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    quantity integer DEFAULT 0
);


ALTER TABLE public.stock OWNER TO postgres;

--
-- TOC entry 252 (class 1259 OID 18645)
-- Name: transport_remitos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transport_remitos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero integer NOT NULL,
    customer_id uuid,
    customer_name text,
    transporte_id uuid,
    envia text NOT NULL,
    bultos integer DEFAULT 1 NOT NULL,
    valor numeric(12,2),
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.transport_remitos OWNER TO postgres;

--
-- TOC entry 251 (class 1259 OID 18644)
-- Name: transport_remitos_numero_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.transport_remitos_numero_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.transport_remitos_numero_seq OWNER TO postgres;

--
-- TOC entry 4849 (class 0 OID 0)
-- Dependencies: 251
-- Name: transport_remitos_numero_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.transport_remitos_numero_seq OWNED BY public.transport_remitos.numero;


--
-- TOC entry 250 (class 1259 OID 18635)
-- Name: transportes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transportes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo text NOT NULL,
    razon_social text NOT NULL,
    domicilio text,
    telefono text NOT NULL,
    email text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.transportes OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16520)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text,
    password_hash text NOT NULL,
    role text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    warehouse_id uuid,
    active boolean DEFAULT true,
    pct_vendedor numeric(8,4) DEFAULT 0,
    negocio_id uuid NOT NULL
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 239 (class 1259 OID 17214)
-- Name: vendedores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendedores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    email text,
    activo boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    negocio_id uuid NOT NULL
);


ALTER TABLE public.vendedores OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 16585)
-- Name: warehouses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    negocio_id uuid NOT NULL
);


ALTER TABLE public.warehouses OWNER TO postgres;

--
-- TOC entry 235 (class 1259 OID 16931)
-- Name: web_order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.web_order_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    web_order_id uuid NOT NULL,
    product_id uuid,
    code text,
    name text NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric(12,2) DEFAULT 0
);


ALTER TABLE public.web_order_items OWNER TO postgres;

--
-- TOC entry 234 (class 1259 OID 16912)
-- Name: web_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.web_orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    numero integer NOT NULL,
    customer_name text,
    customer_email text,
    customer_phone text,
    customer_city text,
    observaciones text,
    color text DEFAULT 'pending'::text,
    reservado boolean DEFAULT false,
    total numeric(12,2) DEFAULT 0,
    order_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    customer_id uuid,
    seller_id uuid,
    negocio_id uuid,
    mp_payment_id text,
    shipping_amount numeric DEFAULT 0
);


ALTER TABLE public.web_orders OWNER TO postgres;

--
-- TOC entry 233 (class 1259 OID 16911)
-- Name: web_orders_numero_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.web_orders_numero_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.web_orders_numero_seq OWNER TO postgres;

--
-- TOC entry 4850 (class 0 OID 0)
-- Dependencies: 233
-- Name: web_orders_numero_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.web_orders_numero_seq OWNED BY public.web_orders.numero;


--
-- TOC entry 4454 (class 2604 OID 18685)
-- Name: conversations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversations ALTER COLUMN id SET DEFAULT nextval('public.conversations_id_seq'::regclass);


--
-- TOC entry 4457 (class 2604 OID 18701)
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- TOC entry 4469 (class 2604 OID 18773)
-- Name: seller_discount_tiers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discount_tiers ALTER COLUMN id SET DEFAULT nextval('public.seller_discount_tiers_id_seq'::regclass);


--
-- TOC entry 4461 (class 2604 OID 18754)
-- Name: seller_discounts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discounts ALTER COLUMN id SET DEFAULT nextval('public.seller_discounts_id_seq'::regclass);


--
-- TOC entry 4451 (class 2604 OID 18649)
-- Name: transport_remitos numero; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_remitos ALTER COLUMN numero SET DEFAULT nextval('public.transport_remitos_numero_seq'::regclass);


--
-- TOC entry 4380 (class 2604 OID 16916)
-- Name: web_orders numero; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_orders ALTER COLUMN numero SET DEFAULT nextval('public.web_orders_numero_seq'::regclass);


--
-- TOC entry 4535 (class 2606 OID 16670)
-- Name: cash_movements cash_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_pkey PRIMARY KEY (id);


--
-- TOC entry 4494 (class 2606 OID 16547)
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- TOC entry 4556 (class 2606 OID 17063)
-- Name: cc_movimientos cc_movimientos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos
    ADD CONSTRAINT cc_movimientos_pkey PRIMARY KEY (id);


--
-- TOC entry 4587 (class 2606 OID 17683)
-- Name: cc_movimientos_prov cc_movimientos_prov_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos_prov
    ADD CONSTRAINT cc_movimientos_prov_pkey PRIMARY KEY (id);


--
-- TOC entry 4615 (class 2606 OID 18691)
-- Name: conversations conversations_access_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_access_token_key UNIQUE (access_token);


--
-- TOC entry 4617 (class 2606 OID 18689)
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- TOC entry 4551 (class 2606 OID 17048)
-- Name: cuentas_corrientes cuentas_corrientes_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cuentas_corrientes
    ADD CONSTRAINT cuentas_corrientes_customer_id_key UNIQUE (customer_id);


--
-- TOC entry 4553 (class 2606 OID 17046)
-- Name: cuentas_corrientes cuentas_corrientes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cuentas_corrientes
    ADD CONSTRAINT cuentas_corrientes_pkey PRIMARY KEY (id);


--
-- TOC entry 4585 (class 2606 OID 17667)
-- Name: cuentas_corrientes_prov cuentas_corrientes_prov_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cuentas_corrientes_prov
    ADD CONSTRAINT cuentas_corrientes_prov_pkey PRIMARY KEY (id);


--
-- TOC entry 4491 (class 2606 OID 16539)
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- TOC entry 4576 (class 2606 OID 17628)
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- TOC entry 4578 (class 2606 OID 17630)
-- Name: favorites favorites_user_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_product_id_key UNIQUE (user_id, product_id);


--
-- TOC entry 4621 (class 2606 OID 18707)
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- TOC entry 4631 (class 2606 OID 19313)
-- Name: negocios negocios_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.negocios
    ADD CONSTRAINT negocios_pkey PRIMARY KEY (id);


--
-- TOC entry 4530 (class 2606 OID 16637)
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- TOC entry 4633 (class 2606 OID 19425)
-- Name: order_shipping order_shipping_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_shipping
    ADD CONSTRAINT order_shipping_pkey PRIMARY KEY (id);


--
-- TOC entry 4527 (class 2606 OID 16621)
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- TOC entry 4533 (class 2606 OID 16656)
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- TOC entry 4566 (class 2606 OID 19365)
-- Name: price_config price_config_negocio_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.price_config
    ADD CONSTRAINT price_config_negocio_unique UNIQUE (negocio_id);


--
-- TOC entry 4568 (class 2606 OID 17587)
-- Name: price_config price_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.price_config
    ADD CONSTRAINT price_config_pkey PRIMARY KEY (id);


--
-- TOC entry 4538 (class 2606 OID 16677)
-- Name: product_costs product_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_costs
    ADD CONSTRAINT product_costs_pkey PRIMARY KEY (id);


--
-- TOC entry 4549 (class 2606 OID 16960)
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- TOC entry 4506 (class 2606 OID 16579)
-- Name: product_prices product_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_prices
    ADD CONSTRAINT product_prices_pkey PRIMARY KEY (id);


--
-- TOC entry 4508 (class 2606 OID 17032)
-- Name: product_prices product_prices_product_id_price_type_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_prices
    ADD CONSTRAINT product_prices_product_id_price_type_key UNIQUE (product_id, price_type);


--
-- TOC entry 4502 (class 2606 OID 16564)
-- Name: products products_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_code_key UNIQUE (code);


--
-- TOC entry 4504 (class 2606 OID 16562)
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- TOC entry 4583 (class 2606 OID 17657)
-- Name: proveedores proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);


--
-- TOC entry 4623 (class 2606 OID 18721)
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- TOC entry 4629 (class 2606 OID 18776)
-- Name: seller_discount_tiers seller_discount_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discount_tiers
    ADD CONSTRAINT seller_discount_tiers_pkey PRIMARY KEY (id);


--
-- TOC entry 4626 (class 2606 OID 18761)
-- Name: seller_discounts seller_discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discounts
    ADD CONSTRAINT seller_discounts_pkey PRIMARY KEY (id);


--
-- TOC entry 4607 (class 2606 OID 18604)
-- Name: seller_images seller_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_images
    ADD CONSTRAINT seller_images_pkey PRIMARY KEY (id);


--
-- TOC entry 4598 (class 2606 OID 18563)
-- Name: seller_pages seller_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_pages
    ADD CONSTRAINT seller_pages_pkey PRIMARY KEY (id);


--
-- TOC entry 4600 (class 2606 OID 18565)
-- Name: seller_pages seller_pages_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_pages
    ADD CONSTRAINT seller_pages_slug_key UNIQUE (slug);


--
-- TOC entry 4604 (class 2606 OID 18582)
-- Name: seller_products seller_products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_products
    ADD CONSTRAINT seller_products_pkey PRIMARY KEY (id);


--
-- TOC entry 4591 (class 2606 OID 18550)
-- Name: sellers sellers_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_email_key UNIQUE (email);


--
-- TOC entry 4593 (class 2606 OID 19407)
-- Name: sellers sellers_google_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_google_id_key UNIQUE (google_id);


--
-- TOC entry 4595 (class 2606 OID 18548)
-- Name: sellers sellers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_pkey PRIMARY KEY (id);


--
-- TOC entry 4572 (class 2606 OID 17621)
-- Name: shop_users shop_users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shop_users
    ADD CONSTRAINT shop_users_email_key UNIQUE (email);


--
-- TOC entry 4574 (class 2606 OID 17619)
-- Name: shop_users shop_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shop_users
    ADD CONSTRAINT shop_users_pkey PRIMARY KEY (id);


--
-- TOC entry 4518 (class 2606 OID 16599)
-- Name: stock stock_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_pkey PRIMARY KEY (id);


--
-- TOC entry 4520 (class 2606 OID 16601)
-- Name: stock stock_product_id_warehouse_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_product_id_warehouse_id_key UNIQUE (product_id, warehouse_id);


--
-- TOC entry 4522 (class 2606 OID 17591)
-- Name: stock stock_product_warehouse_uq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_product_warehouse_uq UNIQUE (product_id, warehouse_id);


--
-- TOC entry 4613 (class 2606 OID 18655)
-- Name: transport_remitos transport_remitos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_remitos
    ADD CONSTRAINT transport_remitos_pkey PRIMARY KEY (id);


--
-- TOC entry 4609 (class 2606 OID 18643)
-- Name: transportes transportes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transportes
    ADD CONSTRAINT transportes_pkey PRIMARY KEY (id);


--
-- TOC entry 4487 (class 2606 OID 16530)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 4489 (class 2606 OID 16528)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 4564 (class 2606 OID 17223)
-- Name: vendedores vendedores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendedores
    ADD CONSTRAINT vendedores_pkey PRIMARY KEY (id);


--
-- TOC entry 4511 (class 2606 OID 17607)
-- Name: warehouses warehouses_name_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_name_unique UNIQUE (name);


--
-- TOC entry 4513 (class 2606 OID 19367)
-- Name: warehouses warehouses_negocio_name_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_negocio_name_unique UNIQUE (negocio_id, name);


--
-- TOC entry 4515 (class 2606 OID 16592)
-- Name: warehouses warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);


--
-- TOC entry 4547 (class 2606 OID 16939)
-- Name: web_order_items web_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_order_items
    ADD CONSTRAINT web_order_items_pkey PRIMARY KEY (id);


--
-- TOC entry 4544 (class 2606 OID 16925)
-- Name: web_orders web_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_orders
    ADD CONSTRAINT web_orders_pkey PRIMARY KEY (id);


--
-- TOC entry 4536 (class 1259 OID 19376)
-- Name: idx_cash_movements_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cash_movements_negocio ON public.cash_movements USING btree (negocio_id);


--
-- TOC entry 4495 (class 1259 OID 19374)
-- Name: idx_categories_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_categories_negocio ON public.categories USING btree (negocio_id);


--
-- TOC entry 4557 (class 1259 OID 17074)
-- Name: idx_cc_movimientos_cuenta; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cc_movimientos_cuenta ON public.cc_movimientos USING btree (cuenta_corriente_id);


--
-- TOC entry 4558 (class 1259 OID 19403)
-- Name: idx_cc_movimientos_cuenta_tipo_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cc_movimientos_cuenta_tipo_date ON public.cc_movimientos USING btree (cuenta_corriente_id, tipo, created_at DESC);


--
-- TOC entry 4559 (class 1259 OID 18536)
-- Name: idx_cc_movimientos_divisa_cobro; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cc_movimientos_divisa_cobro ON public.cc_movimientos USING btree (divisa_cobro);


--
-- TOC entry 4560 (class 1259 OID 17075)
-- Name: idx_cc_movimientos_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cc_movimientos_order ON public.cc_movimientos USING btree (order_id);


--
-- TOC entry 4588 (class 1259 OID 18537)
-- Name: idx_cc_movimientos_prov_divisa_cobro; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cc_movimientos_prov_divisa_cobro ON public.cc_movimientos_prov USING btree (divisa_cobro);


--
-- TOC entry 4618 (class 1259 OID 19267)
-- Name: idx_conversations_seller; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_conversations_seller ON public.conversations USING btree (seller_id);


--
-- TOC entry 4554 (class 1259 OID 19404)
-- Name: idx_cuentas_corrientes_nonzero_saldo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cuentas_corrientes_nonzero_saldo ON public.cuentas_corrientes USING btree (id) WHERE (saldo <> (0)::numeric);


--
-- TOC entry 4492 (class 1259 OID 19370)
-- Name: idx_customers_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customers_negocio ON public.customers USING btree (negocio_id);


--
-- TOC entry 4579 (class 1259 OID 17641)
-- Name: idx_favorites_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_favorites_user_id ON public.favorites USING btree (user_id);


--
-- TOC entry 4619 (class 1259 OID 19268)
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id);


--
-- TOC entry 4528 (class 1259 OID 16686)
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);


--
-- TOC entry 4523 (class 1259 OID 16684)
-- Name: idx_orders_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_customer ON public.orders USING btree (customer_id);


--
-- TOC entry 4524 (class 1259 OID 19375)
-- Name: idx_orders_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_negocio ON public.orders USING btree (negocio_id);


--
-- TOC entry 4525 (class 1259 OID 16685)
-- Name: idx_orders_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);


--
-- TOC entry 4531 (class 1259 OID 16687)
-- Name: idx_payments_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payments_order ON public.payments USING btree (order_id);


--
-- TOC entry 4496 (class 1259 OID 19401)
-- Name: idx_products_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_active ON public.products USING btree (negocio_id, name) WHERE (deleted_at IS NULL);


--
-- TOC entry 4497 (class 1259 OID 16683)
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_category ON public.products USING btree (category_id);


--
-- TOC entry 4498 (class 1259 OID 19402)
-- Name: idx_products_code_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_code_negocio ON public.products USING btree (code, negocio_id) WHERE (code IS NOT NULL);


--
-- TOC entry 4499 (class 1259 OID 17589)
-- Name: idx_products_costo_usd; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_costo_usd ON public.products USING btree (costo_usd);


--
-- TOC entry 4500 (class 1259 OID 19373)
-- Name: idx_products_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_negocio ON public.products USING btree (negocio_id);


--
-- TOC entry 4580 (class 1259 OID 17658)
-- Name: idx_proveedores_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_proveedores_name ON public.proveedores USING btree (name);


--
-- TOC entry 4581 (class 1259 OID 19371)
-- Name: idx_proveedores_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_proveedores_negocio ON public.proveedores USING btree (negocio_id);


--
-- TOC entry 4627 (class 1259 OID 18782)
-- Name: idx_seller_discount_tiers_seller; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_seller_discount_tiers_seller ON public.seller_discount_tiers USING btree (seller_id, threshold);


--
-- TOC entry 4605 (class 1259 OID 18623)
-- Name: idx_seller_images_sid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_seller_images_sid ON public.seller_images USING btree (seller_id, product_id);


--
-- TOC entry 4596 (class 1259 OID 18621)
-- Name: idx_seller_pages_slug; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_seller_pages_slug ON public.seller_pages USING btree (slug);


--
-- TOC entry 4601 (class 1259 OID 18622)
-- Name: idx_seller_products_sid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_seller_products_sid ON public.seller_products USING btree (seller_id);


--
-- TOC entry 4589 (class 1259 OID 18620)
-- Name: idx_sellers_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sellers_email ON public.sellers USING btree (email);


--
-- TOC entry 4569 (class 1259 OID 17648)
-- Name: idx_shop_users_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_shop_users_customer_id ON public.shop_users USING btree (customer_id);


--
-- TOC entry 4570 (class 1259 OID 17642)
-- Name: idx_shop_users_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_shop_users_email ON public.shop_users USING btree (email);


--
-- TOC entry 4516 (class 1259 OID 16688)
-- Name: idx_stock_product; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_stock_product ON public.stock USING btree (product_id);


--
-- TOC entry 4610 (class 1259 OID 18666)
-- Name: idx_transport_remitos_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transport_remitos_created_at ON public.transport_remitos USING btree (created_at DESC);


--
-- TOC entry 4611 (class 1259 OID 18667)
-- Name: idx_transport_remitos_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transport_remitos_customer_id ON public.transport_remitos USING btree (customer_id);


--
-- TOC entry 4485 (class 1259 OID 19368)
-- Name: idx_users_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_negocio ON public.users USING btree (negocio_id);


--
-- TOC entry 4561 (class 1259 OID 19372)
-- Name: idx_vendedores_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendedores_negocio ON public.vendedores USING btree (negocio_id);


--
-- TOC entry 4562 (class 1259 OID 17224)
-- Name: idx_vendedores_nombre; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendedores_nombre ON public.vendedores USING btree (nombre);


--
-- TOC entry 4509 (class 1259 OID 19369)
-- Name: idx_warehouses_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_warehouses_negocio ON public.warehouses USING btree (negocio_id);


--
-- TOC entry 4545 (class 1259 OID 16951)
-- Name: idx_web_order_items_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_web_order_items_order ON public.web_order_items USING btree (web_order_id);


--
-- TOC entry 4539 (class 1259 OID 16950)
-- Name: idx_web_orders_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_web_orders_created ON public.web_orders USING btree (created_at);


--
-- TOC entry 4540 (class 1259 OID 17076)
-- Name: idx_web_orders_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_web_orders_customer ON public.web_orders USING btree (customer_id);


--
-- TOC entry 4541 (class 1259 OID 19390)
-- Name: idx_web_orders_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_web_orders_negocio ON public.web_orders USING btree (negocio_id);


--
-- TOC entry 4542 (class 1259 OID 18624)
-- Name: idx_web_orders_seller; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_web_orders_seller ON public.web_orders USING btree (seller_id);


--
-- TOC entry 4624 (class 1259 OID 19278)
-- Name: seller_discounts_page_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX seller_discounts_page_id_key ON public.seller_discounts USING btree (page_id);


--
-- TOC entry 4602 (class 1259 OID 19289)
-- Name: seller_products_page_id_product_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX seller_products_page_id_product_id_key ON public.seller_products USING btree (page_id, product_id);


--
-- TOC entry 4654 (class 2606 OID 19354)
-- Name: cash_movements cash_movements_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 4655 (class 2606 OID 18630)
-- Name: cash_movements cash_movements_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);


--
-- TOC entry 4637 (class 2606 OID 19344)
-- Name: categories categories_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 4638 (class 2606 OID 16548)
-- Name: categories categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- TOC entry 4665 (class 2606 OID 17064)
-- Name: cc_movimientos cc_movimientos_cuenta_corriente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos
    ADD CONSTRAINT cc_movimientos_cuenta_corriente_id_fkey FOREIGN KEY (cuenta_corriente_id) REFERENCES public.cuentas_corrientes(id) ON DELETE CASCADE;


--
-- TOC entry 4666 (class 2606 OID 17069)
-- Name: cc_movimientos cc_movimientos_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos
    ADD CONSTRAINT cc_movimientos_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- TOC entry 4675 (class 2606 OID 17684)
-- Name: cc_movimientos_prov cc_movimientos_prov_cuenta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos_prov
    ADD CONSTRAINT cc_movimientos_prov_cuenta_fkey FOREIGN KEY (cuenta_corriente_id) REFERENCES public.cuentas_corrientes_prov(id) ON DELETE CASCADE;


--
-- TOC entry 4676 (class 2606 OID 17689)
-- Name: cc_movimientos_prov cc_movimientos_prov_order_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos_prov
    ADD CONSTRAINT cc_movimientos_prov_order_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- TOC entry 4667 (class 2606 OID 19391)
-- Name: cc_movimientos cc_movimientos_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cc_movimientos
    ADD CONSTRAINT cc_movimientos_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);


--
-- TOC entry 4686 (class 2606 OID 18692)
-- Name: conversations conversations_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id);


--
-- TOC entry 4664 (class 2606 OID 17049)
-- Name: cuentas_corrientes cuentas_corrientes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cuentas_corrientes
    ADD CONSTRAINT cuentas_corrientes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- TOC entry 4674 (class 2606 OID 17668)
-- Name: cuentas_corrientes_prov cuentas_corrientes_prov_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cuentas_corrientes_prov
    ADD CONSTRAINT cuentas_corrientes_prov_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE CASCADE;


--
-- TOC entry 4636 (class 2606 OID 19324)
-- Name: customers customers_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 4671 (class 2606 OID 17636)
-- Name: favorites favorites_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 4672 (class 2606 OID 17631)
-- Name: favorites favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.shop_users(id) ON DELETE CASCADE;


--
-- TOC entry 4687 (class 2606 OID 18708)
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- TOC entry 4651 (class 2606 OID 16638)
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 4652 (class 2606 OID 16643)
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- TOC entry 4692 (class 2606 OID 19426)
-- Name: order_shipping order_shipping_web_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_shipping
    ADD CONSTRAINT order_shipping_web_order_id_fkey FOREIGN KEY (web_order_id) REFERENCES public.web_orders(id) ON DELETE CASCADE;


--
-- TOC entry 4645 (class 2606 OID 16622)
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- TOC entry 4646 (class 2606 OID 19349)
-- Name: orders orders_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 4647 (class 2606 OID 19396)
-- Name: orders orders_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.users(id);


--
-- TOC entry 4648 (class 2606 OID 17694)
-- Name: orders orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.proveedores(id) ON DELETE SET NULL;


--
-- TOC entry 4649 (class 2606 OID 16627)
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- TOC entry 4650 (class 2606 OID 17699)
-- Name: orders orders_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;


--
-- TOC entry 4653 (class 2606 OID 16657)
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 4669 (class 2606 OID 19359)
-- Name: price_config price_config_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.price_config
    ADD CONSTRAINT price_config_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 4656 (class 2606 OID 16678)
-- Name: product_costs product_costs_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_costs
    ADD CONSTRAINT product_costs_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 4663 (class 2606 OID 16961)
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 4641 (class 2606 OID 16580)
-- Name: product_prices product_prices_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_prices
    ADD CONSTRAINT product_prices_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 4639 (class 2606 OID 16565)
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- TOC entry 4640 (class 2606 OID 19339)
-- Name: products products_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 4673 (class 2606 OID 19329)
-- Name: proveedores proveedores_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 4690 (class 2606 OID 19279)
-- Name: seller_discount_tiers seller_discount_tiers_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discount_tiers
    ADD CONSTRAINT seller_discount_tiers_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.seller_pages(id) ON DELETE CASCADE;


--
-- TOC entry 4691 (class 2606 OID 18777)
-- Name: seller_discount_tiers seller_discount_tiers_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discount_tiers
    ADD CONSTRAINT seller_discount_tiers_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 4688 (class 2606 OID 19273)
-- Name: seller_discounts seller_discounts_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discounts
    ADD CONSTRAINT seller_discounts_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.seller_pages(id) ON DELETE CASCADE;


--
-- TOC entry 4689 (class 2606 OID 18764)
-- Name: seller_discounts seller_discounts_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_discounts
    ADD CONSTRAINT seller_discounts_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 4681 (class 2606 OID 19410)
-- Name: seller_images seller_images_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_images
    ADD CONSTRAINT seller_images_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.seller_pages(id) ON DELETE CASCADE;


--
-- TOC entry 4682 (class 2606 OID 18610)
-- Name: seller_images seller_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_images
    ADD CONSTRAINT seller_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 4683 (class 2606 OID 18605)
-- Name: seller_images seller_images_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_images
    ADD CONSTRAINT seller_images_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 4677 (class 2606 OID 18568)
-- Name: seller_pages seller_pages_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_pages
    ADD CONSTRAINT seller_pages_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 4678 (class 2606 OID 19284)
-- Name: seller_products seller_products_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_products
    ADD CONSTRAINT seller_products_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.seller_pages(id) ON DELETE CASCADE;


--
-- TOC entry 4679 (class 2606 OID 18590)
-- Name: seller_products seller_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_products
    ADD CONSTRAINT seller_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 4680 (class 2606 OID 18585)
-- Name: seller_products seller_products_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seller_products
    ADD CONSTRAINT seller_products_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE CASCADE;


--
-- TOC entry 4670 (class 2606 OID 17643)
-- Name: shop_users shop_users_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shop_users
    ADD CONSTRAINT shop_users_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- TOC entry 4643 (class 2606 OID 16602)
-- Name: stock stock_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- TOC entry 4644 (class 2606 OID 16607)
-- Name: stock stock_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;


--
-- TOC entry 4684 (class 2606 OID 18656)
-- Name: transport_remitos transport_remitos_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_remitos
    ADD CONSTRAINT transport_remitos_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- TOC entry 4685 (class 2606 OID 18661)
-- Name: transport_remitos transport_remitos_transporte_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_remitos
    ADD CONSTRAINT transport_remitos_transporte_id_fkey FOREIGN KEY (transporte_id) REFERENCES public.transportes(id) ON DELETE SET NULL;


--
-- TOC entry 4634 (class 2606 OID 19314)
-- Name: users users_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 4635 (class 2606 OID 17704)
-- Name: users users_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;


--
-- TOC entry 4668 (class 2606 OID 19334)
-- Name: vendedores vendedores_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendedores
    ADD CONSTRAINT vendedores_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 4642 (class 2606 OID 19319)
-- Name: warehouses warehouses_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 4661 (class 2606 OID 16945)
-- Name: web_order_items web_order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_order_items
    ADD CONSTRAINT web_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- TOC entry 4662 (class 2606 OID 16940)
-- Name: web_order_items web_order_items_web_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_order_items
    ADD CONSTRAINT web_order_items_web_order_id_fkey FOREIGN KEY (web_order_id) REFERENCES public.web_orders(id) ON DELETE CASCADE;


--
-- TOC entry 4657 (class 2606 OID 17033)
-- Name: web_orders web_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_orders
    ADD CONSTRAINT web_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- TOC entry 4658 (class 2606 OID 19385)
-- Name: web_orders web_orders_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_orders
    ADD CONSTRAINT web_orders_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 4659 (class 2606 OID 16926)
-- Name: web_orders web_orders_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_orders
    ADD CONSTRAINT web_orders_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- TOC entry 4660 (class 2606 OID 18615)
-- Name: web_orders web_orders_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.web_orders
    ADD CONSTRAINT web_orders_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id) ON DELETE SET NULL;


-- Completed on 2026-04-29 01:11:32

--
-- PostgreSQL database dump complete
--

