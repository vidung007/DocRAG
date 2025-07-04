const express = require('express');
const router = express.Router();
const AWS = require('aws-sdk');

// Configure AWS SDK
const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

/**
 * POST /api/pdf/signed-url
 * Generate a signed URL for accessing PDF files from S3
 */
router.post('/signed-url', async (req, res) => {
  try {
    const { s3Url } = req.body;
    
    console.log('📄 Generating signed URL for:', s3Url);
    
    if (!s3Url || !s3Url.startsWith('s3://')) {
      return res.status(400).json({ error: 'Valid S3 URL is required' });
    }
    
    // Parse S3 URL
    const s3Match = s3Url.match(/^s3:\/\/([^\/]+)\/(.+)$/);
    if (!s3Match) {
      return res.status(400).json({ error: 'Invalid S3 URL format' });
    }
    
    const [, bucket, key] = s3Match;
    
    // Validate that the request is for a PDF file
    if (!key.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Only PDF files are allowed' });
    }
    
    console.log('🔍 Generating signed URL for bucket:', bucket, 'key:', key);
    
    // Generate signed URL (valid for 1 hour)
    const signedUrl = s3.getSignedUrl('getObject', {
      Bucket: bucket,
      Key: key,
      Expires: 3600, // 1 hour
      ResponseContentType: 'application/pdf'
    });
    
    console.log('✅ Signed URL generated successfully');
    
    res.json({ 
      signedUrl: signedUrl,
      expiresIn: 3600 
    });
    
  } catch (error) {
    console.error('❌ Error generating signed URL:', error);
    
    let statusCode = 500;
    let errorMessage = 'Failed to generate signed URL';
    
    if (error.code === 'NoSuchBucket') {
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

module.exports = router;
