// Tipagem mínima do pacote "pg" (instalado via npm install). Evita exigir @types/pg só para compilar.
declare module "pg" {
  const pg: any;
  export default pg;
}
