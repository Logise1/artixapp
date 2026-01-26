# Artix
 
Una aplicación de aula tipo Slack para Profesores y Estudiantes.
 
## Cómo Ejecutar
 
Debido a que esta aplicación utiliza Módulos JavaScript para Firebase, **debes ejecutarla usando un servidor web local**. No funcionará si simplemente haces doble clic en `login.html`.
 
### Opción 1: VS Code Live Server
1. Haz clic derecho en `login.html` en VS Code.
2. Selecciona "Open with Live Server".
 
### Opción 2: Node vía Terminal
Ejecuta el siguiente comando en la terminal para iniciar un servidor simple:
 
```bash
npx serve .
```
 
Luego abre la URL mostrada (usualmente `http://localhost:3000`).
 
## Características
 
- **Autenticación**: Regístrate como Estudiante o Profesor.
- **Profesores**: Crear clases, añadir estudiantes por correo, crear canales (tipo Chat o Tarea), crear asignaciones.
- **Estudiantes**: Ver clases, chatear en canales, entregar asignaciones (enlaces/archivos).
- **Tiempo Real**: Construido sobre Firebase Firestore para actualizaciones en vivo.
