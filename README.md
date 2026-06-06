# AppAgenda - Unicornio Industries.

AppAgenda is a full-stack application focused on the **management of appointments, clients, and administrative operations**, designed with a modern architecture that clearly separates **Frontend** and **Backend** responsibilities.

The project is built to scale, integrate multiple services, and serve as a solid foundation for real-world production environments.

---

## Overview

AppAgenda centralizes the management of:

- Appointments and scheduling  
- Clients and users  
- Authentication and authorization  
- Reports and data exports  
- Notifications (email / SMS / push – optional)

The system follows **clean architecture principles**, a **service-oriented design**, and asynchronous communication where applicable.

---

## Project Structure

```
appagenda/
│
├── Backend/        # API and business logic
├── Frontend/       # User interface
├── node_modules/   # Frontend dependencies
├── .venv/          # Python virtual environment
└── .git/
```

---

## Backend

The backend is developed in **Python** using **FastAPI**, with a strong focus on performance, asynchronous execution, and strict data validation.

### Core Technologies

- **FastAPI** – REST API framework  
- **Uvicorn** – ASGI server  
- **MongoDB** – NoSQL database  
- **Motor / PyMongo / Beanie** – Database access and ODM  
- **Pydantic v2** – Data validation and schemas  
- **JWT / Passlib / Bcrypt** – Secure authentication  

### Additional Services

- Task scheduling (APScheduler)  
- Excel / PDF export  
- Reporting with Pandas and Matplotlib  
- Notifications (Email, SMS, Push – optional)  
- Redis / RabbitMQ (optional)  

### Running the Backend

```bash
cd Backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

The API will be available at:

```
http://localhost:8000
http://localhost:8000/docs
```

---

## Frontend

The frontend is responsible for the user experience and for consuming the backend API.

It follows a modern **JavaScript-based architecture**, designed to be scalable and maintainable.

### Running the Frontend

```bash
cd Frontend
npm install
npm run dev
```

---

## Environment Variables

The project relies on environment variables for sensitive configuration:

```
MONGO_URI=
JWT_SECRET=
JWT_EXPIRE_MINUTES=
EMAIL_HOST=
EMAIL_PORT=
```

It is strongly recommended to use a `.env` file and exclude it from version control.

---

## Key Features

- Modular and scalable architecture  
- Clear separation between frontend and backend  
- Secure authentication using JWT  
- Ready for microservice-oriented extensions  
- Suitable for production use, SaaS platforms, or advanced academic projects  

---

## Project Status

Currently under active development.

This project can serve as a foundation for:

- Administrative systems  
- SaaS platforms  
- Production-ready MVPs  
- Advanced full-stack academic projects  

---

## Author

Developed as a full-stack practice project, applying modern software engineering best practices with an emphasis on maintainability, security, and scalability.