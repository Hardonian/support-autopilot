# JobForge API Documentation

## Overview

The JobForge API allows you to submit, monitor, and manage distributed jobs across multiple execution environments.

## Authentication

All API requests require authentication via API key passed in the header:

```
X-API-Key: your_api_key_here
```

## Endpoints

### Submit Job

```
POST /api/v1/jobs
```

Submit a new job for execution.

**Request Body:**
```json
{
  "job_type": "my.job.type",
  "payload": {
    "key": "value"
  },
  "priority": "normal"
}
```

**Response:**
```json
{
  "job_id": "job_1234567890",
  "status": "queued",
  "estimated_start": "2024-01-01T12:00:00Z"
}
```

### Get Job Status

```
GET /api/v1/jobs/:job_id
```

Retrieve the current status of a job.

## Error Handling

Jobs may fail for various reasons:

- `timeout`: Job exceeded maximum execution time
- `resource_exhausted`: Worker ran out of memory/CPU
- `dependency_failed`: Upstream job in workflow failed

## Best Practices

1. Always handle job failures gracefully
2. Use idempotent job types when possible
3. Set appropriate timeouts for your workload
4. Monitor job queue depth for capacity planning

## Rate Limits

- 1000 job submissions per minute per API key
- 10000 status checks per minute per API key

## Support

For API support, email api-support@jobforge.io or submit a ticket through the dashboard.
