#!/bin/bash

BASE_URL="http://localhost:8000/api/auth"
TOKEN="paste_your_token_here"

# ─── Register: Manager ───────────────────────────────────────────────────────
curl -s -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "Alice Manager",
    "email": "manager@example.com",
    "password": "password123",
    "role": "Manager"
  }' | jq

# ─── Register: Team Lead ──────────────────────────────────────────────────────
curl -s -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "Bob TeamLead",
    "email": "teamlead@example.com",
    "password": "password123",
    "role": "Team Lead",
    "managerId": "MANAGER_ID_HERE"
  }' | jq

# ─── Register: Employee ───────────────────────────────────────────────────────
curl -s -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "Charlie Employee",
    "email": "employee@example.com",
    "password": "password123",
    "role": "Employee",
    "managerId": "MANAGER_ID_HERE",
    "teamLeadId": "TEAMLEAD_ID_HERE"
  }' | jq

# ─── Login ────────────────────────────────────────────────────────────────────
curl -s -X POST "$BASE_URL/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "manager@example.com",
    "password": "password123"
  }' | jq

# ─── Get Me (authenticated) ───────────────────────────────────────────────────
curl -s -X GET "$BASE_URL/me" \
  -H "Authorization: Bearer $TOKEN" | jq

# ─── Validation: missing fields ───────────────────────────────────────────────
curl -s -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d '{ "email": "bad@example.com" }' | jq

# ─── Validation: invalid email ────────────────────────────────────────────────
curl -s -X POST "$BASE_URL/login" \
  -H "Content-Type: application/json" \
  -d '{ "email": "not-an-email", "password": "password123" }' | jq

# ─── Validation: duplicate email ─────────────────────────────────────────────
curl -s -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "Duplicate",
    "email": "manager@example.com",
    "password": "password123",
    "role": "Manager"
  }' | jq
