declare module 'sql.js' {
  export type Database = {
    exec: (sql: string, params?: readonly unknown[]) => Array<{ values: unknown[][] }>
    run: (sql: string, params?: readonly unknown[]) => void
    export: () => Uint8Array
    close: () => void
  }

  export type SqlJsStatic = {
    Database: new (data?: Uint8Array | readonly number[]) => Database
  }

  export type SqlJsInitOptions = {
    locateFile?: (file: string) => string
  }

  export default function initSqlJs(options?: SqlJsInitOptions): Promise<SqlJsStatic>
}
