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
 
## 🚀 Características Principales

### 👥 **Gestión de Clases**
- Crear y unirse a clases con códigos únicos
- Roles: Profesores, Administradores y Estudiantes
- Canales personalizables (chat, tareas, archivos)
- Configuración de permisos por canal

### 💬 **Sistema de Mensajería**
- Chat en tiempo real por clase
- Mensajes directos entre usuarios
- Adjuntar archivos e imágenes
- Sistema de respuestas (replies)
- Reacciones con emojis

### 📝 **Asignaciones y Tareas**
- Crear y gestionar tareas
- Sistema de entregas para estudiantes
- Vista de entregas para profesores
- Adjuntar archivos a tareas

### 📁 **Gestión de Archivos por Clase**
- Canal de archivos automático en cada clase
- Carpeta "Materiales de clase" protegida (solo admins y profesores)
- Crear carpetas y organizar archivos
- Subir archivos de cualquier tipo
- Renombrar, mover y eliminar archivos/carpetas
- Seguimiento de quién modificó cada archivo
- Sincronización en tiempo real
- Permisos basados en roles

### ☁️ **Mi Drive (Almacenamiento Personal)**
- Almacenamiento personal tipo OneDrive para cada usuario
- Crear y organizar carpetas
- Subir cualquier tipo de archivo
- **Crear y editar documentos de texto**
- Vista previa de imágenes y PDFs
- Navegación con breadcrumbs
- Menú contextual (click derecho)
- Indicador de espacio usado
- Todo sincronizado en la nube

### 🔒 **Autenticación y Permisos**
- Sistema de whitelist para estudiantes y profesores
- Autenticación con Firebase
- Permisos granulares por rol
- Fotos de perfil personalizables

## 🛠️ Tecnologías

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Firebase (Auth, Firestore)
- **Almacenamiento**: 
  - Firebase Storage (fotos de perfil)
  - YeetYourFiles (archivos de clases y drive)
