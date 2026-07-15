#!/bin/bash

BASE_URL="http://localhost:8000/api/tasks"
MANAGER_TOKEN="paste_manager_token_here"
TEAMLEAD_TOKEN="paste_teamlead_token_here"
EMPLOYEE_TOKEN="paste_employee_token_here"
TASK_ID="paste_task_id_here"
USER_ID="paste_user_id_to_assign_here"

# ─── Get All Tasks ────────────────────────────────────────────────────────────
# Manager: sees all | Team Lead: self + team | Employee: own only
curl -s -X GET "$BASE_URL" \
  -H "Authorization: Bearer $MANAGER_TOKEN" | jq

curl -s -X GET "$BASE_URL" \
  -H "Authorization: Bearer $TEAMLEAD_TOKEN" | jq

curl -s -X GET "$BASE_URL" \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" | jq

# ─── Get Task by ID ───────────────────────────────────────────────────────────
curl -s -X GET "$BASE_URL/$TASK_ID" \
  -H "Authorization: Bearer $MANAGER_TOKEN" | jq

# ─── Create Task: Manager (assign to anyone) ──────────────────────────────────
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Manager created task\",
    \"description\": \"Assigned to a specific user\",
    \"assignedTo\": \"$USER_ID\"
  }" | jq

# ─── Create Task: Team Lead (assign to self or team member) ───────────────────
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $TEAMLEAD_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Team lead task\",
    \"description\": \"Assigned to a team member\",
    \"assignedTo\": \"$USER_ID\"
  }" | jq

# ─── Create Task: Employee (auto-assigned to self) ────────────────────────────
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My own task",
    "description": "Automatically assigned to me"
  }' | jq

# ─── Update Task ──────────────────────────────────────────────────────────────
curl -s -X PUT "$BASE_URL/$TASK_ID" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated title",
    "status": "completed"
  }' | jq

# ─── Reassign Task (Manager only) ─────────────────────────────────────────────
curl -s -X PATCH "$BASE_URL/$TASK_ID/reassign" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"assignedTo\": \"$USER_ID\"
  }" | jq

# ─── Delete Task (Manager only) ───────────────────────────────────────────────
curl -s -X DELETE "$BASE_URL/$TASK_ID" \
  -H "Authorization: Bearer $MANAGER_TOKEN" | jq

# ─── Validation: missing title ────────────────────────────────────────────────
curl -s -X POST "$BASE_URL" \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "description": "No title provided" }' | jq

# ─── Validation: invalid status ───────────────────────────────────────────────
curl -s -X PUT "$BASE_URL/$TASK_ID" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "in-progress" }' | jq

# ─── Validation: invalid MongoDB ID ──────────────────────────────────────────
curl -s -X GET "$BASE_URL/invalid-id-123" \
  -H "Authorization: Bearer $MANAGER_TOKEN" | jq

# ─── Unauthorized: Employee trying to delete ─────────────────────────────────
curl -s -X DELETE "$BASE_URL/$TASK_ID" \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" | jq

# ─── Unauthorized: Team Lead trying to reassign ──────────────────────────────
curl -s -X PATCH "$BASE_URL/$TASK_ID/reassign" \
  -H "Authorization: Bearer $TEAMLEAD_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"assignedTo\": \"$USER_ID\"}" | jq
