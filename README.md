# DoIt — Gestor de tareas

Aplicación responsive de HTML, CSS y JavaScript sin framework, con:

- Registro / inicio de sesión local (contraseña derivada con PBKDF2, no guardada en texto plano)
- Dashboard adaptado a desktop, tablet y móvil
- Categorías permanentes por usuario: crear, editar y borrar (si no tienen tareas)
- Tareas con título obligatorio, descripción, prioridad, categoría, fecha y hora límite obligatorias
- Varios recordatorios por tarea, entre 15 minutos y 2 semanas, más recordatorios personalizados (minutos, horas, días o semanas)
- Contadores de pendientes, completadas y vencidas
- Calendario mensual, búsqueda, filtros, edición y eliminación
- Avisos dentro de la aplicación y notificaciones del navegador (si das permiso)

## Cómo ejecutar

1. Abre la carpeta `DoIt` en VS Code.
2. Inicia un servidor local (Live Server en VS Code o `python -m http.server 5500`).
3. Visita `http://localhost:5500` y crea una cuenta.

Los datos se almacenan con `localStorage` en el navegador y no se sincronizan entre dispositivos. No es un sistema de autenticación para producción: el código se ejecuta en el cliente y puede manipularse. Para una app pública, hace falta autenticación, base de datos y sesiones del lado servidor.

### Recordatorios

Los avisos se revisan aproximadamente cada 30 segundos mientras la app está abierta y al volver a la pestaña. Para recibir notificaciones del sistema, pulsa la campana y activa el permiso. Si el navegador o la página está completamente cerrada, **no se enviarán recordatorios**. Para eso hace falta una solución con backend, push y service worker.

Las tareas, categorías y recordatorios creados aquí usan almacenamiento `doit_v2_*`, separado de una posible versión anterior.
