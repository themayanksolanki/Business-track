#!/bin/bash

BASE_URL="http://localhost:8000/api/users"
MANAGER_TOKEN="paste_manager_token_here"
TEAMLEAD_TOKEN="paste_teamlead_token_here"
EMPLOYEE_TOKEN="paste_employee_token_here"

# ─── Get All Users (Manager only) ────────────────────────────────────────────
curl -s -X GET "$BASE_URL" \
  -H "Authorization: Bearer $MANAGER_TOKEN" | jq

# ─── Get All Team Leads (Manager only) ───────────────────────────────────────
curl -s -X GET "$BASE_URL/team-leads" \
  -H "Authorization: Bearer $MANAGER_TOKEN" | jq

# ─── Get Team Members (Team Lead only) ───────────────────────────────────────
curl -s -X GET "$BASE_URL/team-members" \
  -H "Authorization: Bearer $TEAMLEAD_TOKEN" | jq

# ─── Unauthorized: Employee accessing all users ───────────────────────────────
curl -s -X GET "$BASE_URL" \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" | jq

# ─── Unauthorized: no token ───────────────────────────────────────────────────
curl -s -X GET "$BASE_URL" | jq
