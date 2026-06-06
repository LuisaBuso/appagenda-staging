# 🧠 Brain - Asistente de Inteligencia Artificial

## 🧾 Introducción

**Brain** es un sistema web que implementa un **asistente de inteligencia artificial** orientado a facilitar la gestión de comunidades, análisis de datos y automatización de procesos de negocio.

Este asistente funciona como el núcleo de una plataforma digital, donde se puede interactuar con distintas secciones: visualizar dashboards, administrar bases de datos, gestionar comunidades, usar canales omnicanal y acceder a una inteligencia contextualizada.

El sistema está desarrollado con **React + TypeScript**, empleando rutas protegidas, componentes reutilizables, autenticación basada en contexto y estilos con **TailwindCSS**.


## 🗂️ Estructura del FRONTEND

FRONTEND/
│
├── brain/                # Lógica central del asistente
├── node_modules/         # Dependencias
├── public/               # Archivos públicos (logo, etc.)
├── src/
├── components/           # Componentes reutilizables
│   ├── agents/           # Componentes relacionados con agentes de IA
│   ├── alerts/           # Módulos de alertas o notificaciones
│   ├── community/        # UI y lógica de gestión de comunidades
│   └── ui/               # Elementos visuales reutilizables (Sidebar, Icons, etc.)
├── contexts/             # Contextos globales (AuthContext, UserContext, etc.)
│   └── AuthContext.tsx
├── hooks/                # Hooks personalizados
│   ├── use-toast.ts      # Hook para mostrar notificaciones
│   └── useWebSocket.ts   # Hook para manejar WebSockets
├── lib/                  # Funciones utilitarias y helpers
│   └── utils.ts
├── pages/                # Vistas principales de la aplicación, asociadas a rutas
│   ├── BusinessPage/
│   ├── ComunityPage/
│   ├── DashboardPage/
│   ├── DatabasePage/
│   ├── IntelligencePage/
│   ├── LoginPage/
│   └── OmnichannelPage/
├── types/                # Definiciones globales de tipos TypeScript
│   ├── community.d.ts
│   └── community.ts
├── App.tsx               # Componente principal con configuración de rutas
├── main.tsx              # Punto de entrada de la aplicación
├── package.json          # Dependencias del proyecto
├── README.md             # Documentación
└── tailwind.config.js    # Configuración de estilos

---

## 🚦 Ruteo y Seguridad

En `App.tsx` se definen rutas públicas y protegidas usando `react-router-dom`.

- **Rutas públicas**:
  - `/`: Página de login (`LoginPage`)
  - `/comunidad/:slug`: Acceso a una comunidad pública sin iniciar sesión

- **Rutas protegidas** (requieren login):
  - `/dashboard`: Vista principal
  - `/database`: Datos internos
  - `/business`: Funcionalidades comerciales
  - `/omnichannel`: Canales de comunicación
  - `/intelligence`: IA y procesamiento
  - `/communities`, `/create`, `/manages`, `/[id]`: Gestión completa de comunidades

El componente `ProtectedRoute` valida el acceso mediante el `AuthContext`, y si el usuario no está autenticado, lo redirige al login.

---

## 🧩 Componentes principales

| Componente           | Descripción |
|----------------------|-------------|
| `Layout`             | Estructura común (Sidebar, Header) para páginas internas |
| `Sidebar`            | Menú lateral de navegación entre módulos |
| `TooltipProvider`    | Sistema de tooltips interactivos para mejorar UX |
| `AuthProvider`       | Proveedor de autenticación global con React Context |
| `ProtectedRoute`     | Lógica que protege rutas y evita accesos no autorizados |
| `Icons.tsx`          | Iconos personalizados reutilizables en toda la interfaz |

---

## 🧠 Funcionalidades del Asistente Brain 

Brain no es solo una app visual: está pensada para simular una **inteligencia artificial que ayuda a gestionar** una organización digital. Estas son sus capacidades implementadas:

- ✅ Autenticación y control de sesiones de usuario
- 🏘️ Crear, editar y explorar comunidades con reglas propias
- 📊 Mostrar dashboards con datos relevantes y decisiones automatizadas
- 🔄 Integrarse con diferentes canales de comunicación (omnichannel)
- 🧠 Consultar módulos de inteligencia para recomendaciones, análisis de datos, o predicciones
- 🔒 Seguridad basada en rutas protegidas

---

## ⚙️ Cómo ejecutar el proyecto

1. Clona el repositorio:

   ```bash
   git clone https://github.com/UnicornIn/brain
   cd brain/frontend

2. Instala dependencias:

    ```bash
    npm install

3. Corre el entorno de desarrollo:

    ```bash
    npm run dev

4. Abre http://localhost:5173 en tu navegador.

---

## 🧰 Tecnologías utilizadas

| Tecnología             | Descripción |
|------------------------|-------------|
| **React + TypeScript** | Framework principal de desarrollo del frontend con tipado estático y componentes reutilizables.

| **React Router**       | Sistema de navegación que permite gestionar rutas públicas y protegidas.

| **TailwindCSS**        | Framework de estilos basado en clases utilitarias para un diseño rápido y responsivo.

| **Context API**        | Sistema de gestión de estado global, usado aquí para la autenticación de usuarios.

| **Vite**               | Bundler moderno y extremadamente rápido que optimiza el desarrollo local.

| **PostCSS**            | Herramienta de procesamiento de CSS que permite usar Tailwind y otras funcionalidades avanzadas.

# 🧠 Backend - Brain

El backend de **Brain** está construido en **Python**, diseñado para funcionar como API RESTful y facilitar la comunicación con el frontend. Está organizado de forma modular, permitiendo escalar funcionalidades como autenticación, gestión de agentes de IA, administración de comunidades, canales omnicanal y más.

---

## 🗂️ Estructura del BACKEND

BACKEND/
├── app/                       # Módulo principal del backend
│   ├── agents/                # Lógica de los agentes de IA
│   │   ├── alerts/            # Sistema de alertas personalizadas
│   │   ├── asistent/          # Lógica del asistente inteligente
│   │   ├── upload/            # Subida de archivos del asistente
│   │   ├── models.py          # Modelos de datos del asistente
│   │   └── routes.py          # Endpoints API de los agentes
│   │
│   ├── auth/                  # Autenticación, tokens y seguridad
│   │   ├── createusers/       # Registro de usuarios
│   │   ├── jwt/               # Generación y validación JWT
│   │   ├── login/             # Módulo de login
│   │   ├── models.py          # Modelos de autenticación
│   │   └── routes.py          # Endpoints de autenticación
│   │
│   ├── client/                # Lógica del cliente (usuarios o bots)
│   │   ├── keepclient/        # Funciones específicas del cliente
│   │   ├── controllers.py     # Lógica de negocio para clientes
│   │   ├── models.py          # Modelos de base de datos
│   │   ├── routes.py          # Endpoints de cliente
│   │   └── schemas.py         # Validación de datos
│   │
│   ├── community/             # Módulo de comunidades
│   │   ├── community_member/  # Gestión de miembros
│   │   ├── module_community/  # Funcionalidad principal de comunidades
│   │   ├── models.py          # Modelos de comunidad
│   │   └── routes.py          # Rutas de API para comunidades
│   │
│   ├── core/                  # Configuración general del sistema
│   │   └── settings.py        # Variables de entorno y configuraciones globales
│   │
│   ├── database/              # Conexión a MongoDB y definiciones de colección
│   │   ├── collection.py      # Definición de colecciones
│   │   └── mongo.py           # Conexión a la base de datos
│   │
│   ├── manychat/              # Integración con ManyChat
│   │   ├── controllers.py     # Controladores para mensajes/eventos
│   │   ├── models.py          # Modelos de integración
│   │   ├── routes.py          # Endpoints para integración
│   │   └── schemas.py         # Esquemas de validación
│   │
│   └── omnicanal/             # Manejo de múltiples canales de comunicación
│       ├── controllers.py     # Lógica de negocio omnicanal
│       ├── models.py          # Modelos de comunicación
│       ├── omnicanal.py       # Procesos principales del canal
│       └── routers.py         # Rutas y endpoints
│
├── venv/                      # Entorno virtual de Python
│   ├── Include/
│   ├── Lib/
│   └── Scripts/
│
├── .env                       # Variables de entorno (tokens, rutas, claves)
├── .gitignore                 # Ignora archivos temporales y sensibles
├── requirements.txt           # Lista de dependencias necesarias
└── run.py                     # Script principal para ejecutar la aplicación

---

## 🧠 Funcionalidades del Backend

- ✅ Módulo	   Función
- 🧠agents/	    Define y gestiona los - agentes inteligentes (respuestas, lógica, perfiles).
- 🔐auth/	    Login, creación de tokens JWT, validaciones y middleware de seguridad.
- 👤client/	    omunicación externa, posibles APIs de consumo.
- 🏘️community/	 CRUD de comunidades, asignación de usuarios, datos públicos y privados.
- ⚙️core/	    Configuración global, excepciones personalizadas, arranque de app.
- 🧩database/	Conexión, modelos de datos y migraciones si aplica.
- 📬manychat/	Recepción y envío de mensajes desde la plataforma ManyChat.
- 📡omnicanal/	Manejador para múltiples canales como WhatsApp, Telegram, email, etc.

---

## ⚙️ Cómo ejecutar el backend

1. Crea y activa tu entorno virtual:

   ```bash
   python -m venv venv
   source venv/Scripts/activate   # En Windows
   # o
   source venv/bin/activate       # En Linux/macOS

2. Instala las dependencias:

    ```bash
    pip install -r requirements.txt

3. Configura tus variables en .env (ejemplo: DB_URL, SECRET_KEY).

4. Ejecuta el servidor:

    ```bash
    python run.py

---

## 🔧 Tecnologías y herramientas del Backend

| Tecnología          | Descripción |
|---------------------|-------------|
| **Python**          | Lenguaje principal del backend. |
| **FastAPI**         | Framework para crear APIs rápidas y modernas con validación automática. |
| **Pydantic**        | Validación de datos y serialización. |
| **MongoDB**         | Base de datos NoSQL utilizada para almacenar datos estructurados. |
| **pymongo / motor** | Librerías para conectarse y operar sobre MongoDB. |
| **ManyChat API**    | Integración con chatbot omnicanal. |
| **Uvicorn**         | Servidor ASGI de alto rendimiento para producción. |
| **dotenv**          | Carga automática de variables de entorno desde `.env`. 