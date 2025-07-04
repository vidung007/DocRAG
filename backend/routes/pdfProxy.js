const express = require('express');
const router = express.Router();
const AWS = require('aws-sdk');

// Configure AWS SDK
const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Middleware to verify authentication
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/pdf-proxy/:bucket/:key
 * Proxy PDF files from S3 to avoid CORS issues
 */
router.get('/proxy/:bucket/:key(*)', requireAuth, async (req, res) => {
  try {
    const { bucket, key } = req.params;
    
    console.log('📄 PDF Proxy request:', { bucket, key });
    
    // Validate that the request is for a PDF file
    if (!key.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Only PDF files are allowed' });
    }
    
    // Create S3 parameters
    const s3Params = {
      Bucket: bucket,
      Key: key
    };
    
    console.log('🔍 Fetching from S3:', s3Params);
    
    // Check if object exists first
    try {
      await s3.headObject(s3Params).promise();
    } catch (headError) {
      console.error('❌ PDF not found in S3:', headError.message);
      if (headError.statusCode === 404) {
        return res.status(404).json({ error: 'PDF file not found' });
      }
      if (headError.statusCode === 403) {
        return res.status(403).json({ error: 'Access denied to PDF file' });
      }
      throw headError;
    }
    
    // Get the object from S3
    const s3Object = await s3.getObject(s3Params).promise();
    
    console.log('✅ PDF retrieved successfully, size:', s3Object.Body.length);
    
    // Set appropriate headers for PDF content
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': s3Object.Body.length,
      'Content-Disposition': `inline; filename="${key.split('/').pop()}"`,
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'http://localhost:3000',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type'
    });
    
    // Send the PDF content
    res.send(s3Object.Body);
    
  } catch (error) {
    console.error('❌ Error proxying PDF:', error);
    
    let statusCode = 500;
    let errorMessage = 'Failed to retrieve PDF';
    
    if (error.statusCode === 404) {
      statusCode = 404;
      errorMessage = 'PDF file not found';
    } else if (error.statusCode === 403) {
      statusCode = 403;
      errorMessage = 'Access denied to PDF file';
    } else if (error.code === 'NoSuchBucket') {
      statusCode = 404;
      errorMessage = 'S3 bucket not found';
    } else if (error.code === 'NoSuchKey') {
      statusCode = 404;
      errorMessage = 'PDF file not found in bucket';
    }
    
    res.status(statusCode).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * OPTIONS /api/pdf-proxy/:bucket/:key
 * Handle CORS preflight requests
 */
router.options('/proxy/:bucket/:key(*)', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'http://localhost:3000',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400' // 24 hours
  });
  res.status(200).end();
});

module.exports = router;
