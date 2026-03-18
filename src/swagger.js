export const swaggerOptions = {
  openapi: {
    openapi: '3.0.0',
    info: {
      title: 'wahaGI - WhatsApp Gateway API',
      description: 'Multi-tenant WhatsApp API wrapper using Baileys library',
      version: '1.0.0',
      contact: {
        name: 'API Support'
      }
    },
    servers: [
      {
        url: process.env.PUBLIC_URL || 'http://localhost:3021',
        description: 'Active Server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Session: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            status: {
              type: 'string',
              enum: ['connecting', 'qr', 'connected', 'disconnected']
            },
            webhook_url: { type: 'string', format: 'uri', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            last_seen: { type: 'string', format: 'date-time', nullable: true }
          }
        },
        QRResponse: {
          type: 'object',
          properties: {
            qr: { type: 'string', description: 'Base64 encoded QR code image' },
            status: { type: 'string' }
          }
        },
        Message: {
          type: 'object',
          properties: {
            message_id: { type: 'string' },
            status: { type: 'string' }
          }
        },
        MediaMessage: {
          type: 'object',
          properties: {
            message_id: { type: 'string' },
            status: { type: 'string' },
            media_url: { type: 'string', format: 'uri' },
            media_path: { type: 'string' },
            media_size: { type: 'integer' }
          }
        },
        Media: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            filename: { type: 'string' },
            mime_type: { type: 'string' },
            size: { type: 'integer' },
            url: { type: 'string', format: 'uri' },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Health', description: 'Health check endpoint' },
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Sessions', description: 'WhatsApp session management' },
      { name: 'Messages', description: 'Send messages' },
      { name: 'Media', description: 'Media file management' },
      { name: 'Chats', description: 'Chat and contact management' }
    ]
  }
};

export const swaggerUIOptions = {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false
  },
  staticCSP: true
};
