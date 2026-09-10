# Pruebas de PostgreSQL

Esta suite ejecuta el esquema y la migración en un PostgreSQL real y temporal. Verifica publicación, validaciones, propietario, capacidad, cancelación, idempotencia, notificaciones, rollback ante un fallo real de escritura, permisos y RLS. Las pruebas de concurrencia usan conexiones independientes y comprueban el bloqueo mediante `pg_stat_activity` antes de liberar la transacción.

Requiere PostgreSQL 17 o posterior (`initdb`, `pg_ctl` y `psql`). No necesita dependencias npm adicionales, Docker, credenciales Supabase ni conexión a una base remota.

Desde `server`:

```powershell
$env:PG_BIN = 'C:\Program Files\PostgreSQL\17\bin'
node --test test/database/routes.database.test.mjs
```

En Linux/macOS, `PG_BIN` puede apuntar al directorio de binarios o dejarse vacío si están en `PATH`. PostgreSQL no permite ejecutar `initdb` como root.

El runner crea un directorio con prefijo `asientolibre-db-test-` en la carpeta temporal del sistema, elige un puerto libre y escucha únicamente en `127.0.0.1`. Al terminar detiene el servidor y elimina exclusivamente ese directorio. El esquema mínimo `auth` de la suite reproduce el contrato de roles y claves foráneas utilizado por la migración; no ejecuta el servicio HTTP de Supabase Auth ni PostgREST.

Para reutilizar un cluster de QA creado específicamente para esta suite, se pueden definir `ASIENTO_DB_TEST_DIR` y `ASIENTO_DB_TEST_PORT`. Solo se aceptan directorios temporales con los prefijos de QA, y se verifica que el puerto pertenezca exactamente a ese directorio antes de escribir. El esquema del cluster debe estar vacío; el runner no borra datos preexistentes ni detiene clusters suministrados.

El esquema base se aplica dos veces para comprobar que su instalación sea repetible. La migración versionada se aplica una vez. No se deben ejecutar las fixtures de esta carpeta en Supabase.
