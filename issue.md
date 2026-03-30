# Unit Testing Implementation Plan

## Overview
Implementasi unit testing untuk semua endpoint API dengan berbagai skenario pengujian yang sesuai. Proyek ini adalah Multi-tenant WhatsApp API wrapper menggunakan Baileys dengan Fastify framework.

## Project Stack
- **Framework**: Fastify (Node.js)
- **Testing**: Node.js built-in test runner
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: JWT with Bearer tokens
- **Files**: `.test.js` extension (existing pattern)

## Current Test Status

### Already Implemented Tests
- ✅ `health.test.js` - Health check endpoint (basic)
- ✅ `auth.test.js` - Authentication endpoints (login, register, me)
- ✅ `sessions.test.js` - Basic session management (partial coverage)
- ✅ `messages.test.js` - Message sending (validation only, no actual WhatsApp)
- ✅ `chats.test.js` - Basic chat endpoints (minimal coverage)

### Missing Tests
- ❌ `contacts.test.js` - Contact management endpoints
- ❌ `media.test.js` - Media upload/management endpoints
- ❌ Enhanced tests for existing modules with missing scenarios

---

## Test Coverage Requirements

### 1. Auth API (`/auth`)

**Current Status**: Partial coverage

**Missing/Enhanced Scenarios**:
| Endpoint | Current | Missing Scenarios |
|----------|---------|------------------|
| POST `/auth/login` | ✅ Done | - Token expiration validation<br>- JWT payload structure validation |
| POST `/auth/register` | ✅ Done | - Password strength validation<br>- Username format validation |
| GET `/auth/me` | ✅ Done | - Token refresh behavior<br>- Session invalidation scenarios |

---

### 2. Sessions API (`/sessions`)

**Current Status**: Partial coverage (~60%)

**Missing/Enhanced Scenarios**:
| Endpoint | Current | Missing Scenarios |
|----------|---------|------------------|
| POST `/sessions` | ✅ Done | - Duplicate session names<br>- Session quota limits |
| GET `/sessions` | ✅ Done | - Pagination support<br>- Empty list scenario |
| GET `/sessions/:id` | ✅ Done | - None |
| GET `/sessions/:id/qr` | ❌ Missing | - QR expiration handling<br>- Reconnection scenarios |
| DELETE `/sessions/:id` | ✅ Done | - Active session cleanup<br>- Cascade deletion validation |
| POST `/sessions/:id/webhook` | ✅ Done | - Invalid URL validation<br>- Webhook timeout scenarios |
| POST `/sessions/:id/profile-picture` | ❌ Missing | - File upload validation<br>- Unsupported file types<br>- File size limits<br>- Session not connected scenario |
| POST `/sessions/:id/status` | ❌ Missing | - Empty text validation<br>- Text length limits<br>- Session not connected scenario |
| POST `/sessions/:id/restart` | ❌ Missing | - Session already disconnected<br>- Restart timeout scenarios |
| GET `/sessions/:id/status` | ❌ Missing | - Status synchronization checks<br>- Database vs live status comparison |

---

### 3. Chats API (`/sessions/:id/chats`)

**Current Status**: Minimal coverage (~20%)

**Missing/Enhanced Scenarios**:
| Endpoint | Current | Missing Scenarios |
|----------|---------|------------------|
| GET `/sessions/:id/chats` | ⚠️ Basic only | - Empty chats list<br>- Pagination with limit parameter<br>- Chat ordering validation<br>- Large dataset handling |
| GET `/sessions/:id/chats/:lid/messages` | ❌ Missing | - Invalid LID format<br>- LID URL encoding/decoding<br>- Limit parameter validation (1-100)<br>- Empty message history<br>- Message ordering (newest/oldest)<br>- Special characters in LID |
| POST `/sessions/:id/chats/:lid/read` | ❌ Missing | - Non-existent chat LID<br>- Already read chat<br>- Database update verification<br>- Zero unread count scenario |
| GET `/messages/:lid` | ❌ Missing | - Messages across multiple sessions<br>- Session filter validation<br>- Limit parameter (1-200)<br>- Empty results scenario<br>- LID not found |

---

### 4. Messages API (`/sessions/:id/send`)

**Current Status**: Validation only (~40%)

**Missing/Enhanced Scenarios**:
| Endpoint | Current | Missing Scenarios |
|----------|---------|------------------|
| POST `/sessions/:id/send` | ⚠️ Validation | - Reply to message validation<br>- Special characters in message<br>- Message length limits<br>- Empty message scenario<br>- Invalid LID format for `to` |
| POST `/sessions/:id/send-media` | ⚠️ Validation | - Multiple media files<br>- Caption with special chars<br>- Invalid media ID<br>- Media file not found<br>- Unsupported media types |
| GET `/sessions/:id/contacts` | ⚠️ Basic only | - Empty contacts list<br>- Contact limit (200) validation<br>- Contact data structure validation |

---

### 5. Contacts API (`/contacts`)

**Current Status**: No tests (0%)

**New Test File Needed**: `contacts.test.js`

**Required Scenarios**:
| Endpoint | Test Scenarios |
|----------|----------------|
| GET `/contacts` | - Empty contacts list<br>- Pagination support<br>- Contact data structure<br>- Ordering by last message time |
| GET `/contacts/:id` | - Contact found<br>- Contact not found (404)<br>- Invalid UUID format<br>- Unauthorized access |
| PUT `/contacts/:id/name` | - Successful name update<br>- Empty name validation (400)<br>- Whitespace-only name<br>- Contact not found (404)<br>- Special characters in name |
| DELETE `/contacts/:id` | - Successful deletion<br>- Contact not found (404)<br>- Invalid UUID format<br>- Cascade deletion of related data |

---

### 6. Media API

**Current Status**: No tests (0%)

**Note**: Check if media routes exist in codebase or need to be created first.

**Required Scenarios** (if routes exist):
| Endpoint | Test Scenarios |
|----------|----------------|
| POST `/media/upload` | - Successful upload<br>- File size limits<br>- Unsupported MIME types<br>- Empty file<br>- Authentication required |
| GET `/media` | - Empty media list<br>- Pagination<br>- Media ownership filter<br>- User-specific results |
| GET `/media/:id` | - Media found<br>- Media not found (404)<br>- Unauthorized access (403)<br>- Invalid UUID |
| DELETE `/media/:id` | - Successful deletion<br>- Media not found (404)<br>- Unauthorized access<br>- File cleanup validation |

---

## Testing Infrastructure Requirements

### 1. Test Helpers Enhancement
**File**: `test/helpers.js`

**Additions Needed**:
- Database seed helper (pre-populate test data)
- Mock session manager for WhatsApp connection simulation
- Media file generation helpers
- Multi-user setup helpers for ownership testing

### 2. Test Database Setup
**File**: `.env.test`

**Ensure**:
- Separate test database configuration
- Clean database before each test suite
- Proper isolation between test runs

### 3. Mocking Strategy
For endpoints requiring actual WhatsApp connection:
- Mock `sessionManager` functions
- Mock `messageSender` service
- Use in-memory stores for testing without real connections

---

## Test Structure Pattern

### Standard Test File Template
```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fastify from 'fastify';
import { prisma } from '../src/db/client.js';
import { routeName } from '../src/routes/routeName.js';
import { createTestApp } from './helpers.js';

describe('Module Name API', () => {
  let app;
  let authToken;
  let testUser;
  let testSessionId;

  before(async () => {
    // Setup: create test app, user, session, generate token
  });

  after(async () => {
    // Cleanup: delete test data, close app
  });

  describe('POST /endpoint', () => {
    it('should succeed with valid data', async () => {
      // Test happy path
    });

    it('should validate required fields', async () => {
      // Test validation errors
    });

    it('should return 401 without auth', async () => {
      // Test authentication
    });
  });

  describe('GET /endpoint/:id', () => {
    it('should return resource', async () => {
      // Test successful retrieval
    });

    it('should return 404 for non-existent', async () => {
      // Test not found scenario
    });
  });
});
```

---

## Implementation Priority

### Phase 1: Core Endpoints (High Priority)
1. **Contacts API** - New test file, critical for user data management
2. **Sessions API** - Complete missing QR, profile picture, status, restart tests
3. **Chats API** - Add comprehensive message history and read mark tests

### Phase 2: Validation & Edge Cases (Medium Priority)
1. **Messages API** - Enhanced validation, special characters, limits
2. **Auth API** - JWT validation, token scenarios
3. **Sessions API** - Edge cases, quotas, cleanup

### Phase 3: Media & Advanced Features (Low Priority)
1. **Media API** - If routes exist, implement comprehensive tests
2. **Webhook Integration** - Test webhook delivery (if applicable)
3. **Performance Tests** - Large dataset handling, pagination

---

## Acceptance Criteria

Each test suite should:
- ✅ Cover all HTTP status codes returned by the endpoint
- ✅ Test authentication/authorization for protected routes
- ✅ Validate input parameters and error responses
- ✅ Test edge cases (empty lists, non-existent resources)
- ✅ Verify data ownership (multi-tenant isolation)
- ✅ Clean up test data after completion
- ✅ Be runnable independently with `node --test test/module.test.js`
- ✅ Pass when running `npm test`

---

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
node --test test/contacts.test.js

# Run in watch mode
npm run test:watch

# Run with coverage
node --test --experimental-test-coverage test/**/*.test.js
```

---

## Notes for Junior Developer

1. **Start with one module at a time** - Don't try to do everything at once
2. **Follow existing patterns** - Look at `auth.test.js` and `sessions.test.js` as templates
3. **Test validation before success** - Start with error cases, they're easier to mock
4. **Use existing helpers** - `createTestApp()` and `generateToken()` are your friends
5. **Always clean up** - Delete test data in `after()` blocks
6. **Database isolation** - Use unique usernames/timestamps to avoid conflicts
7. **Mock WhatsApp dependencies** - Don't try to connect to real WhatsApp
8. **Test ownership** - Verify users can't access other users' data
9. **Run tests frequently** - Catch issues early
10. **Ask questions** - If a test scenario is unclear, ask for clarification

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Endpoint Coverage | 100% (all endpoints tested) |
| Happy Path Tests | 100% |
| Error Path Tests | 100% |
| Auth Tests | 100% of protected endpoints |
| Data Ownership Tests | 100% of multi-tenant resources |
| Test Pass Rate | 100% (all tests passing) |
