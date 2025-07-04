const express = require('express');
const router = express.Router();
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configure AWS S3
const s3 = new AWS.S3({
    region: process.env.AWS_REGION || 'us-east-1'
});

// Temporary directory for PDF files
const TEMP_DIR = path.join(__dirname, '../temp-pdfs');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Store active temp files with cleanup timers
const activeTempFiles = new Map();

// Clean up temp file after specified time (default 10 minutes)
const scheduleCleanup = (filePath, fileName, timeoutMs = 10 * 60 * 1000) => {
    const timeoutId = setTimeout(() => {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Cleaned up temp PDF: ${fileName}`);
            }
            activeTempFiles.delete(fileName);
        } catch (error) {
            console.error(`Error cleaning up temp PDF ${fileName}:`, error);
        }
    }, timeoutMs);
    
    activeTempFiles.set(fileName, { filePath, timeoutId });
};

// Route to get PDF file temporarily
router.get('/view/:bucketName/*', async (req, res) => {
    try {
        const bucketName = req.params.bucketName;
        const s3Key = req.params[0]; // Everything after bucketName
        
        console.log(`Attempting to serve PDF: ${bucketName}/${s3Key}`);
        
        // Generate unique filename for temp storage
        const tempFileName = `${uuidv4()}_${path.basename(s3Key)}`;
        const tempFilePath = path.join(TEMP_DIR, tempFileName);
        
        // Check if we already have this file in temp storage
        const existingFile = Array.from(activeTempFiles.values()).find(
            file => file.originalKey === s3Key && fs.existsSync(file.filePath)
        );
        
        if (existingFile) {
            console.log(`Serving existing temp PDF: ${s3Key}`);
            return res.sendFile(existingFile.filePath);
        }
        
        // Download from S3 to temp location
        const params = {
            Bucket: bucketName,
            Key: s3Key
        };
        
        console.log(`Downloading from S3: ${JSON.stringify(params)}`);
        
        const s3Object = await s3.getObject(params).promise();
        
        // Write to temp file
        fs.writeFileSync(tempFilePath, s3Object.Body);
        
        console.log(`PDF downloaded to temp location: ${tempFilePath}`);
        
        // Schedule cleanup
        scheduleCleanup(tempFilePath, tempFileName);
        
        // Store reference with original key for deduplication
        activeTempFiles.set(tempFileName, {
            filePath: tempFilePath,
            originalKey: s3Key,
            timeoutId: activeTempFiles.get(tempFileName)?.timeoutId
        });
        
        // Set appropriate headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(s3Key)}"`);
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        // Send the file
        res.sendFile(tempFilePath);
        
    } catch (error) {
        console.error('Error serving PDF:', error);
        
        if (error.code === 'NoSuchKey') {
            return res.status(404).json({ error: 'PDF file not found' });
        }
        
        if (error.code === 'NoSuchBucket') {
            return res.status(404).json({ error: 'S3 bucket not found' });
        }
        
        res.status(500).json({ error: 'Failed to load PDF file' });
    }
});

// Route to manually clean up a specific temp file
router.delete('/cleanup/:fileName', (req, res) => {
    const fileName = req.params.fileName;
    const tempFile = activeTempFiles.get(fileName);
    
    if (tempFile) {
        try {
            clearTimeout(tempFile.timeoutId);
            if (fs.existsSync(tempFile.filePath)) {
                fs.unlinkSync(tempFile.filePath);
            }
            activeTempFiles.delete(fileName);
            res.json({ message: 'Temp file cleaned up successfully' });
        } catch (error) {
            console.error(`Error manually cleaning up ${fileName}:`, error);
            res.status(500).json({ error: 'Failed to clean up temp file' });
        }
    } else {
        res.status(404).json({ error: 'Temp file not found' });
    }
});

// Route to clean up all temp files
router.delete('/cleanup-all', (req, res) => {
    try {
        let cleanedCount = 0;
        
        for (const [fileName, tempFile] of activeTempFiles.entries()) {
            try {
                clearTimeout(tempFile.timeoutId);
                if (fs.existsSync(tempFile.filePath)) {
                    fs.unlinkSync(tempFile.filePath);
                    cleanedCount++;
                }
            } catch (error) {
                console.error(`Error cleaning up ${fileName}:`, error);
            }
        }
        
        activeTempFiles.clear();
        
        res.json({ 
            message: `Cleaned up ${cleanedCount} temp files`,
            cleanedCount 
        });
    } catch (error) {
        console.error('Error during bulk cleanup:', error);
        res.status(500).json({ error: 'Failed to clean up temp files' });
    }
});

// Test route to check if service is working
router.get('/test', (req, res) => {
    res.json({ 
        message: 'Temp PDF viewer service is running',
        tempDir: TEMP_DIR,
        activeTempFiles: activeTempFiles.size
    });
});

// Graceful shutdown cleanup
process.on('SIGTERM', () => {
    console.log('Cleaning up temp PDF files on shutdown...');
    for (const [fileName, tempFile] of activeTempFiles.entries()) {
        try {
            clearTimeout(tempFile.timeoutId);
            if (fs.existsSync(tempFile.filePath)) {
                fs.unlinkSync(tempFile.filePath);
            }
        } catch (error) {
            console.error(`Error cleaning up ${fileName} on shutdown:`, error);
        }
    }
});

module.exports = router;
