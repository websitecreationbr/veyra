// Faz o papel do pacote "pg" SÓ no teste de emulação da Vercel (aqui não dá para instalar o "pg").
// Aceita as mesmas opções que o app passa ao Pool e usa o cliente de protocolo nativo dos testes.
import { WirePool } from "../pgwire.js";

class Pool extends WirePool {
  constructor(o: { connectionString: string; max?: number }) {
    const u = new URL(o.connectionString);
    super({ host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), searchPath: process.env.VEYRA_TEST_SCHEMA, max: o.max });
  }
}
const pg = { Pool, types: { setTypeParser() { /* o cliente de teste já converte int8/numeric */ } } };
export default pg;
export { Pool };
module.exports = pg;
