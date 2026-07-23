# TaskFlow

A full-stack task management application built with the MEAN stack (MongoDB, Express, Angular, Node.js). TaskFlow supports role-based access control, team collaboration, and a clean modern UI.

---

## Features

- **Role-based access** — Manager, Team Lead, and Employee roles with different permissions
- **Task management** — Create, edit, delete, and reassign tasks via modals (no page navigation)
- **Status tracking** — Toggle task status between Pending and Completed; sort by status in the task list
- **Team collaboration** — Managers assign tasks to any user; Team Leads assign within their team
- **User activation flow** — New users register as inactive and are activated by their referenced manager or team lead
- **Pagination** — Task list paginated with smart ellipsis page numbers
- **Modern UI** — Bootstrap 5 + Bootstrap Icons, split-panel auth pages, dark navbar, colored role badges

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 18 (standalone components) |
| Backend | Node.js + Express |
| Database | MongoDB + Mongoose |
| Auth | JWT (JSON Web Tokens) |
| Styling | Bootstrap 5.3 + Bootstrap Icons 1.11 |

---

## Project Structure

```
TaskFlow/
├── backend/
│   ├── controllers/       # authController, taskController, userController
│   ├── middleware/        # JWT auth, role guard, error handler
│   ├── models/            # User, Task (Mongoose schemas)
│   ├── routes/            # Auth, task, and user routes
│   ├── utils/
│   └── index.js           # Express entry point
│
└── frontend/
    └── src/
        └── app/
            ├── core/
            │   ├── guards/        # Auth and role guards
            │   ├── interceptors/  # JWT token interceptor
            │   └── services/      # Auth, Task, User services
            ├── models/            # TypeScript interfaces
            └── pages/
                ├── dashboard/
                ├── login/
                ├── register/
                ├── task-list/
                ├── edit-task/
                ├── user-list/
                └── team-lead-task-view/
```

---

## Getting Started

### Prerequisites

- Node.js v18+
- MongoDB (local or Atlas)
- Angular CLI (`npm install -g @angular/cli`)

### Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in the `backend/` directory:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
```

Start the backend server:

```bash
node index.js
```

### Frontend Setup

```bash
cd frontend
npm install
ng serve
```

The app runs at `http://localhost:4200` and proxies API calls to `http://localhost:5000`.

---

## Role Permissions

| Action | Employee | Team Lead | Manager |
|---|:---:|:---:|:---:|
| Create tasks | ✓ | ✓ | ✓ |
| Assign tasks to others | | ✓ (team only) | ✓ (all users) |
| Reassign tasks | | | ✓ |
| Delete own tasks | ✓ | ✓ | ✓ |
| Delete any task | | ✓ (employees) | ✓ (all) |
| View team tasks | | ✓ | ✓ |
| View all users | | | ✓ |
| Activate new users | | ✓ (employees) | ✓ (team leads) |

---

## API Overview

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login and receive JWT |

### Tasks
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tasks` | Get tasks for current user |
| POST | `/api/tasks` | Create a new task |
| GET | `/api/tasks/:id` | Get task by ID |
| PUT | `/api/tasks/:id` | Update a task |
| DELETE | `/api/tasks/:id` | Delete a task |
| PATCH | `/api/tasks/:id/reassign` | Reassign task to another user |

### Users
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/users` | Get all active users (Manager only) |
| GET | `/api/users/team-members` | Get team members (Team Lead) |
| GET | `/api/users/pending` | Get users awaiting activation |
| PATCH | `/api/users/:id/activate` | Activate a pending user |

---

## License

MIT
