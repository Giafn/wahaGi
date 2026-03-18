# Testing Guide

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
node --test test/auth.test.js

# Run with coverage (Node.js 20+)
node --test --experimental-test-coverage test/**/*.test.js
```

## Test Structure

```
test/
├── helpers.js           # Test utilities and helpers
├── auth.test.js         # Authentication API tests
├── sessions.test.js     # Session management API tests
├── messages.test.js     # Messaging API tests
├── media.test.js        # Media upload/management tests
├── chats.test.js        # Chats API tests
└── health.test.js       # Health check endpoint tests
```

## Test Environment

Tests use a separate test database (`test.db`) to avoid affecting development/production data.

Environment variables for testing are loaded from `.env.test`:
- `DATABASE_URL` - SQLite file for test database
- `JWT_SECRET` - Secret key for JWT tokens in tests
- `AUTH_DIR` - Directory for test session auth files
- `MEDIA_DIR` - Directory for test media files

## Test Coverage

Tests cover:

### Auth API
- ✅ User registration (success, validation errors, duplicate username)
- ✅ User login (success, invalid credentials, missing fields)
- ✅ Get current user (with/without token, invalid token)

### Sessions API
- ✅ Create session
- ✅ List sessions
- ✅ Get single session
- ✅ Get QR code
- ✅ Update webhook URL
- ✅ Delete session
- ✅ Restart session
- ✅ Session ownership validation

### Messages API
- ✅ Send text message (validation, session ownership)
- ✅ Send media message (validation, media ownership)
- ✅ Get contacts

### Media API
- ✅ Upload files
- ✅ List media with pagination
- ✅ Get single media
- ✅ Delete media
- ✅ Media ownership validation

### Chats API
- ✅ Get chats list
- ✅ Session validation

### Health API
- ✅ Health check endpoint
- ✅ Timestamp format validation

## Writing New Tests

```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fastify from 'fastify';

describe('My API', () => {
  let app;

  before(async () => {
    app = fastify({ logger: false });
    // Register routes
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it('should do something', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/endpoint',
      payload: { data: 'test' }
    });

    assert.strictEqual(response.statusCode, 200);
  });
});
```

## CI/CD Integration

Add to your CI pipeline:

```yaml
# Example GitHub Actions
- name: Run Tests
  run: npm test
  env:
    DATABASE_URL: "file:./test.db"
    JWT_SECRET: "test-secret"
```
