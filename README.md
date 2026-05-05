# SARRA CRM Backend API

Production-grade Node.js backend for the Spring and River Rejuvenation Authority (SARRA) CRM system.

## Tech Stack
- Node.js (ES Modules)
- Express.js
- MongoDB & Mongoose
- JSON Web Tokens (JWT)
- Cloudinary (File Uploads)
- Winston & Morgan (Logging)
- Joi (Validation)

## Prerequisites
- Node.js (v18+)
- MongoDB Atlas cluster or local instance
- Cloudinary account for media storage

## Installation
1. Clone the repository
2. Run `npm install`
3. Copy `.env.example` to `.env` and fill in the required variables
4. Run `npm run dev` to start the server in development mode

## Roles and Permissions

| Role | Permissions |
|---|---|
| `SUPER_ADMIN` | Full access. User management, analytics, global form viewing. |
| `DD_LEVEL` | District-level access. Can review, approve, or reject forms in their district. |
| `PIA_OFFICER` | Can create, save as draft, submit, and resubmit DPR/MPR forms. |

## Seeding Super Admin
To initialize the system, create the first `SUPER_ADMIN` user directly in MongoDB or via a temporary script using `bcryptjs` to hash the password. Once the first super admin is created, all subsequent users can be created via the `/api/v1/admin/users` endpoint.

## API Endpoints Overview

### Auth
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/refresh-token` - Refresh access token
- `POST /api/v1/auth/logout` - User logout
- `GET /api/v1/auth/me` - Get current user profile
- `PATCH /api/v1/auth/change-password` - Change password

### Springshed DPR (PIA_OFFICER)
- `POST /api/v1/dpr/springshed/draft` - Save form draft
- `POST /api/v1/dpr/springshed/submit` - Submit form
- `GET /api/v1/dpr/springshed/my-forms` - List user's forms
- `PATCH /api/v1/dpr/springshed/:id/resubmit` - Resubmit a rejected form

### Springshed DPR Review (DD_LEVEL / SUPER_ADMIN)
- `GET /api/v1/dpr/springshed/district/pending` - List pending forms for review
- `PATCH /api/v1/dpr/springshed/:id/approve` - Approve a form
- `PATCH /api/v1/dpr/springshed/:id/reject` - Reject a form

### Admin
- `POST /api/v1/admin/users` - Create a user
- `GET /api/v1/admin/users` - List users
- `PATCH /api/v1/admin/users/:id/toggle-active` - Deactivate/Activate user
- `GET /api/v1/admin/analytics/overview` - Global analytics
- `GET /api/v1/admin/audit-logs` - View system audit logs
