const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
const s3Service = require('../services/s3Service');
const apiGatewayService = require('../services/apiGatewayService');
const sessionService = require('../services/sessionService');
const { requireAuth, updateTokenInfo } = require('../middleware/auth');
const config = require('../config');
const axios = require('axios');

// Get S3 bucket name from config
const BUCKET_NAME = config.aws.s3.bucketName || s3Service.BUCKET_NAME;

// Configure AWS SDK
const s3 = new AWS.S3({
    region: config.aws.region
});

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Cache for file data
const fileCache = {
  userCaches: {}, // Cache per user
  defaultTTL: 3600000, // 1 hour TTL for cache to reduce API calls
  isFetching: {},
  s3HeadRequestsCache: {} // Cache for S3 headObject requests
};

// Function to clear all caches
function clearAllCaches() {
    console.log('Clearing all file caches');
    fileCache.userCaches = {};
    fileCache.isFetching = {};
    fileCache.s3HeadRequestsCache = {};
}

// Function to get or create a user cache
function getUserCache(userId) {
    if (!userId) {
        userId = 'anonymous';
    }
    
    if (!fileCache.userCaches[userId]) {
        // Initialize cache for this user
        fileCache.userCaches[userId] = {
            data: null,
            timestamp: null
        };
    }
    
    return fileCache.userCaches[userId];
}

// Function to clear cache for a specific user
function clearUserCache(userId) {
    if (!userId) {
        userId = 'anonymous';
    }
    
    if (fileCache.userCaches[userId]) {
        console.log(`Clearing cache for user: ${userId}`);
        fileCache.userCaches[userId] = {
            data: null,
            timestamp: null
        };
    }
}

// Upload file to user's S3 folder
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        // Check if the user is authenticated via session
        let userPath;
        let userUsername;
        
        if (req.session.isAuthenticated && req.session.userInfo && req.session.userInfo.username) {
            // Use authenticated user's username
            userUsername = req.session.userInfo.username;
            // Use the username directly without transformation
            userPath = userUsername;
        } else if (req.body.folderPath) {
            // For non-authenticated users or direct API calls, use the provided folder path
            userPath = req.body.folderPath;
            // Try to extract username from folderPath
            const usernameMatch = req.body.folderPath.match(/^([^\/]+)\//);
            userUsername = usernameMatch ? usernameMatch[1] : 'anonymous';
        } else {
            // Default fallback folder
            userPath = "anonymous/";
            userUsername = "anonymous";
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const fileContent = fs.readFileSync(req.file.path);
        
        // Get file metadata
        const fileSize = req.file.size;
        const originalName = req.file.originalname;
        const mimeType = req.file.mimetype || determineContentType(originalName);
        const fileExtension = originalName.includes('.') ? 
            originalName.split('.').pop().toLowerCase() : '';
        
        // Extract session ID from folderPath if available
        let sessionId = '';
        if (req.body.folderPath) {
            const sessionMatch = req.body.folderPath.match(/session-([^\/]+)/);
            sessionId = sessionMatch ? sessionMatch[0] : '';
        }
        
        // Construct the S3 key based on folder path and file name
        // This will organize files into user/session folders
        let s3Key;
        
        if (req.body.folderPath) {
            // Use the folder path from the request (e.g., "user@example.com/session-123/")
            s3Key = `${req.body.folderPath}${req.file.originalname}`;
        } else {
            // Use the authenticated user path
            s3Key = `${userPath}/${req.file.originalname}`;
        }
        
        // Ensure the key is properly formatted
        s3Key = s3Key.replace(/\/+/g, '/'); // Replace multiple slashes with a single one
        
        // Add metadata to S3 object
        const params = {
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: fileContent,
            ContentType: mimeType,
            Metadata: {
                'original-name': originalName,
                'upload-timestamp': new Date().toISOString(),
                'file-size': fileSize.toString(),
                'file-extension': fileExtension,
                'uploaded-by': userUsername,
                'session-id': sessionId,
                'content-type': mimeType,
                'processed': 'true'
            }
        };
        
        // Create folder structure first (if it doesn't exist)
        if (req.body.folderPath) {
            const folderKey = req.body.folderPath;
            try {
                // Check if folder exists
                const folderParams = {
                    Bucket: BUCKET_NAME,
                    Key: folderKey,
                    Body: '' // Empty body for folder creation
                };
                await s3.putObject(folderParams).promise();
                console.log(`Created folder: ${folderKey}`);
            } catch (folderError) {
                console.error('Error creating folder structure:', folderError);
                // Continue with file upload even if folder creation fails
            }
        }
        
        const uploadResult = await s3.upload(params).promise();
        
        // Clean up the temporary file
        fs.unlinkSync(req.file.path);
        
        // Clear all caches when a new file is uploaded
        clearAllCaches();
        
        res.json({
            success: true,
            message: 'File uploaded successfully',
            fileUrl: uploadResult.Location,
            key: uploadResult.Key,
            metadata: params.Metadata,
            contentType: mimeType,
            size: fileSize,
            fileName: originalName,
            fileType: fileExtension || 'unknown'
        });
    } catch (error) {
        console.error('Error uploading file to S3:', error);
        // Clean up the temporary file if it exists
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.error('Error deleting temporary file:', unlinkError);
            }
        }
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

// Delete file from user's S3 folder
router.delete('/delete-file', requireAuth, async (req, res) => {
    try {
        console.log('Delete file request received:', req.body);
        const { key } = req.body;
        if (!key) {
            console.log('No file key provided in request body');
            return res.status(400).json({ success: false, error: 'No file key provided' });
        }
        
        const userUsername = req.session.userInfo.username;
        const folderName = userUsername;
        
        console.log(`Attempting to delete file with key: ${key} for user: ${userUsername}`);
        
        // Ensure user can only delete files from their own folder
        if (!key.startsWith(`${folderName}/`)) {
            console.log(`Access denied: File key ${key} does not start with ${folderName}/`);
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        const params = {
            Bucket: BUCKET_NAME,
            Key: key
        };
        
        console.log(`Deleting object from S3 bucket ${BUCKET_NAME}, key: ${key}`);
        await s3.deleteObject(params).promise();
        console.log(`Successfully deleted file with key: ${key}`);
        
        // Clear all caches when a file is deleted
        clearAllCaches();
        console.log('All caches cleared after file deletion');
        
        // Check if the file was in a session folder
        const sessionMatch = key.match(/^([^\/]+)\/([^\/]+)\/[^\/]+$/);
        if (sessionMatch && sessionMatch[2] && sessionMatch[2].startsWith('session-')) {
            const username = sessionMatch[1];
            const sessionId = sessionMatch[2];
            const sessionPrefix = `${username}/${sessionId}/`;
            
            console.log(`Checking if session folder ${sessionPrefix} is empty after file deletion`);
            
            // List objects in the session folder
            const listParams = {
                Bucket: BUCKET_NAME,
                Prefix: sessionPrefix,
                MaxKeys: 2 // Only need to check if there's at least one file left
            };
            
            const sessionObjects = await s3.listObjectsV2(listParams).promise();
            
            // If the folder is empty or only contains the folder object itself, delete the folder
            if (!sessionObjects.Contents || 
                sessionObjects.Contents.length === 0 || 
                (sessionObjects.Contents.length === 1 && sessionObjects.Contents[0].Key === sessionPrefix)) {
                
                console.log(`Session folder ${sessionPrefix} is empty, deleting it`);
                
                // Delete the folder object
                const folderParams = {
                    Bucket: BUCKET_NAME,
                    Key: sessionPrefix
                };
                
                await s3.deleteObject(folderParams).promise();
                console.log(`Successfully deleted empty session folder: ${sessionPrefix}`);
            }
        }
        
        console.log('Sending success response for file deletion');
        res.json({
            success: true,
            message: 'File deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting file from S3:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete file',
            message: error.message 
        });
    }
});

// New endpoint to serve file data for the FileTable component
router.get('/api/files', updateTokenInfo, async (req, res) => {
    try {
        console.log('Handling /api/files request');
        
        // Get user ID for cache namespacing
        const userInfo = req.session.userInfo || {};
        const userId = userInfo.username || userInfo.sub || sessionService.getUsernameFromSession(req) || 'anonymous';
        console.log(`Request from user: ${userId}`);
        
        // Get or create user cache
        const userCache = getUserCache(userId);
        
        // Check if we have a valid cache for this user
        const now = Date.now();
        if (userCache.data && (now - userCache.timestamp < fileCache.defaultTTL)) {
            const cacheAge = Math.round((now - userCache.timestamp)/1000);
            console.log(`Returning cached file data for user ${userId}, age: ${cacheAge} seconds`);
            return res.json({
                ...userCache.data,
                source: 'cache',
                cache_age_seconds: cacheAge
            });
        }
        
        // Check if another request from this user is already in progress
        if (fileCache.isFetching[userId]) {
            console.log(`Another request is already fetching data for user ${userId}, waiting for that to complete`);
            // Wait for the in-progress request to complete, then return its results
            // Use a short poll to wait for the cache to be populated
            let attempts = 0;
            const maxAttempts = 10;
            const checkInterval = 200; // 200ms
            
            const waitForCache = async () => {
                if (userCache.data && userCache.timestamp > now) {
                    // Cache was populated during our wait
                    console.log(`Cache was populated during wait for user ${userId}`);
                    const cacheAge = Math.round((Date.now() - userCache.timestamp)/1000);
                    return res.json({
                        ...userCache.data,
                        source: 'cache_after_wait',
                        cache_age_seconds: cacheAge
                    });
                }
                
                attempts++;
                if (attempts >= maxAttempts) {
                    // If we've waited too long, proceed with our own request
                    console.log(`Waited too long for other request, proceeding with own request for ${userId}`);
                    fileCache.isFetching[userId] = false;
                } else {
                    // Wait and check again
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                    return waitForCache();
                }
            };
            
            if (fileCache.isFetching[userId]) {
                return waitForCache();
            }
        }
        
        // Set fetching flag to prevent duplicate requests
        fileCache.isFetching[userId] = true;
        console.log(`Setting fetching flag for user ${userId}`);
        
        // Get access token from session
        const accessToken = sessionService.getAccessToken(req);
        
        try {
            // Try the API Gateway 
            console.log('Attempting to fetch files from API Gateway');
            console.log(`Using access token: ${accessToken ? 'Available' : 'Not Available'}`);
            
            if (!accessToken) {
                console.log('No access token available, returning empty result');
                const emptyResponse = {
                    success: true,
                    Items: [],
                    source: 'no_token',
                    message: 'No access token available'
                };
                
                userCache.data = emptyResponse;
                userCache.timestamp = Date.now();
                fileCache.isFetching[userId] = false;
                
                return res.json(emptyResponse);
            }
            
            // Make a single API Gateway call
            console.log(`Making single API Gateway call for user ${userId}`);
            const apiResponse = await apiGatewayService.fetchFiles(accessToken, userInfo);
            
            // Format the response
            const responseData = { 
                success: true, 
                Items: apiResponse.items || [],
                source: 'apigateway',
                fetch_time: new Date().toISOString()
            };
            
            // Update cache for this user
            userCache.data = responseData;
            userCache.timestamp = Date.now();
            
            // Clear the fetching flag
            console.log(`Clearing fetching flag for user ${userId}`);
            fileCache.isFetching[userId] = false;
            
            return res.json(responseData);
        } catch (err) {
            console.error('Error fetching from API Gateway:', err.message);
            if (err.response) {
                console.error('API Gateway error response:', {
                    status: err.response.status,
                    statusText: err.response.statusText,
                    data: err.response.data
                });
            }
            
            // Return empty results since we don't want S3 fallback
            const emptyResponse = {
                success: true,
                Items: [],
                source: 'apigateway_error',
                error: err.message
            };
            
            // Update cache with empty response
            userCache.data = emptyResponse;
            userCache.timestamp = Date.now();
            fileCache.isFetching[userId] = false;
            
            return res.json(emptyResponse);
        }
    } catch (err) {
        // Make sure to clear fetching flag
        if (req.session && req.session.userInfo) {
            const userId = req.session.userInfo.username || 'anonymous';
            fileCache.isFetching[userId] = false;
        } else {
            // Clear all fetching flags as fallback
            fileCache.isFetching = {};
        }
        
        console.error('Error in /api/files endpoint:', err);
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch files',
            message: err.message 
        });
    }
});

// Endpoint to get session information
router.get('/api/session', (req, res) => {
    try {
        console.log('Handling /api/session request');
        // Create a session for the user
        const sessionInfo = sessionService.createUploadSession(req);
        return res.json({ success: true, ...sessionInfo });
    } catch (error) {
        console.error('Error generating session ID:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to generate session ID',
            message: error.message 
        });
    }
});

// Endpoint to get files for current session - use shared cache if possible
router.get('/api/session/files', updateTokenInfo, async (req, res) => {
    try {
        console.log('Handling /api/session/files request');
        // Get current session info from user's session
        const sessionInfo = req.session.currentUploadSession;
        if (!sessionInfo) {
            return res.json({ success: true, files: [] });
        }
        
        const { username, sessionId } = sessionInfo;
        
        // Get user ID for cache lookup
        const userId = username || sessionService.getUsernameFromSession(req) || 'anonymous';
        
        // First check if we already have data in the files cache
        const userCache = getUserCache(userId);
        const now = Date.now();
        
        // If we have valid cached file data, use it to extract session files
        if (userCache.data && userCache.data.Items && (now - userCache.timestamp < fileCache.defaultTTL)) {
            console.log(`Using cached file data to get session files for session: ${sessionId}`);
            
            // Filter for just this session's files
            const sessionFiles = userCache.data.Items.filter(file => 
                file.sessionId === sessionId && file.fileName // Only include actual files
            );
            
            return res.json({
                success: true,
                files: sessionFiles,
                sessionInfo,
                source: 'file_cache',
                file_count: sessionFiles.length
            });
        }
        
        // If no valid cache, use API Gateway
        const accessToken = sessionService.getAccessToken(req);
        
        // Check if we are already fetching files data
        if (fileCache.isFetching[userId]) {
            console.log(`Already fetching files for ${userId}, waiting for cache to be populated`);
            
            // Wait a short time for the cache to be populated
            let attempts = 0;
            const maxAttempts = 5;
            
            const waitForCache = async () => {
                await new Promise(resolve => setTimeout(resolve, 300));
                
                if (userCache.data && userCache.data.Items && (Date.now() - userCache.timestamp < fileCache.defaultTTL)) {
                    // Cache was populated during our wait
                    const sessionFiles = userCache.data.Items.filter(file => 
                        file.sessionId === sessionId && file.fileName
                    );
                    
                    return res.json({
                        success: true,
                        files: sessionFiles,
                        sessionInfo,
                        source: 'file_cache_after_wait',
                        file_count: sessionFiles.length
                    });
                }
                
                attempts++;
                if (attempts < maxAttempts) {
                    return waitForCache();
                }
                
                // If we've waited too long, just make the API call
                console.log(`Waited too long for file cache, making direct API call for session ${sessionId}`);
                return null;
            };
            
            const cacheResult = await waitForCache();
            if (cacheResult) return; // If we got a result from the cache, we're done
        }
        
        // Make direct API call for session files
        try {
            console.log(`Making API Gateway call specifically for session ${sessionId}`);
            const apiResponse = await apiGatewayService.fetchFiles(accessToken);
            
            if (apiResponse.success && apiResponse.items && apiResponse.items.length > 0) {
                // Filter for current session
                const sessionFiles = apiGatewayService.filterSessionFiles(apiResponse.items, sessionId);
                
                // Format the files
                const formattedFiles = apiGatewayService.formatFiles(sessionFiles, sessionId);
                
                // No need to store in the session cache since we'll get a full file list soon
                
                return res.json({
                    success: true,
                    files: formattedFiles,
                    sessionInfo,
                    source: 'apigateway',
                    file_count: formattedFiles.length
                });
            }
            
            // If no files found, return empty array
            return res.json({
                success: true,
                files: [],
                sessionInfo,
                source: 'apigateway',
                file_count: 0
            });
        } catch (apiError) {
            console.error('Error fetching session files from API Gateway:', apiError);
            
            // Return empty results
            return res.json({
                success: true,
                files: [],
                sessionInfo,
                source: 'apigateway_error',
                error: apiError.message,
                file_count: 0
            });
        }
    } catch (error) {
        console.error('Error retrieving session files:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to retrieve session files',
            message: error.message 
        });
    }
});

// Dashboard statistics endpoint
router.get('/api/dashboard/stats', updateTokenInfo, async (req, res) => {
    try {
        // Get user info from session
        const userInfo = sessionService.getUserFromSession(req);
        const username = userInfo.username;
        
        // Try to get files from API Gateway only, no S3 fallback
        const accessToken = sessionService.getAccessToken(req);
        let files = [];
        
        // Only fetch files if user is authenticated
        if (accessToken && username !== 'anonymous') {
            try {
                const apiResponse = await apiGatewayService.fetchFiles(accessToken);
                // Process API response even if empty
                files = apiResponse.success ? apiResponse.items || [] : [];
            } catch (apiError) {
                console.error('Error fetching from API Gateway for dashboard:', apiError);
                // Continue with empty files array for unauthenticated users
            }
        } else {
            console.log('No authentication - showing empty stats for anonymous user');
        }
        
        // Calculate statistics
        const totalFiles = files.length;
        
        // Group files by session
        const sessions = {};
        files.forEach(file => {
            const sessionId = file.sessionId || 'unknown';
            if (!sessions[sessionId]) {
                sessions[sessionId] = {
                    sessionId,
                    fileCount: 0,
                    totalSize: 0,
                    lastModified: null
                };
            }
            
            sessions[sessionId].fileCount++;
            sessions[sessionId].totalSize += (file.fileSize || file.size || 0);
            
            // Update last modified date if newer
            const fileDate = new Date(file.uploadTimestamp || file.lastModified || Date.now());
            if (!sessions[sessionId].lastModified || 
                fileDate > new Date(sessions[sessionId].lastModified)) {
                sessions[sessionId].lastModified = fileDate.toISOString();
            }
        });
        
        // Convert sessions object to array and sort by last modified date
        const sessionsArray = Object.values(sessions).sort((a, b) => {
            return new Date(b.lastModified || 0) - new Date(a.lastModified || 0);
        });
        
        // Get recent activity (last 5 uploads)
        const recentFiles = files
            .sort((a, b) => {
                const dateA = new Date(a.uploadTimestamp || a.lastModified || 0);
                const dateB = new Date(b.uploadTimestamp || b.lastModified || 0);
                return dateB - dateA;
            })
            .slice(0, 5)
            .map(file => ({
                fileName: file.fileName || file.key?.split('/').pop() || 'Unnamed File',
                sessionId: file.sessionId || 'unknown',
                fileSize: file.fileSize || file.size || 0,
                lastModified: file.uploadTimestamp || file.lastModified || new Date().toISOString(),
                s3Key: file.s3Key || file.key || ''
            }));
        
        res.json({
            success: true,
            stats: {
                totalFiles,
                totalSessions: Object.keys(sessions).length,
                recentSessions: sessionsArray.slice(0, 5),
                recentFiles
            },
            source: 'apigateway',
            authenticated: username !== 'anonymous'
        });
    } catch (error) {
        console.error('Error retrieving dashboard statistics:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to retrieve dashboard statistics',
            message: error.message 
        });
    }
});

// Process folder endpoint
router.post('/processfolder', updateTokenInfo, async (req, res) => {
    try {
        console.log('Processing folder request received:', req.body);
        const { folderName, sessionId } = req.body;
        
        if (!folderName) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameter: folderName'
            });
        }
        
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameter: sessionId'
            });
        }
        
        // Get user info from session
        const userInfo = sessionService.getUserFromSession(req);
        const username = userInfo.username || sessionService.getUsernameFromSession(req) || 'anonymous';
        
        // Get access token
        const accessToken = sessionService.getAccessToken(req);
        if (!accessToken) {
            return res.status(401).json({
                success: false,
                error: 'No access token available'
            });
        }
        
        // Create folderId in the expected format "sessionId/folderName"
        const folderId = `${sessionId}/${folderName}`;
        
        // Call API Gateway to process the folder
        try {
            console.log(`Calling API Gateway to process folder: ${folderName} for user: ${username}, session: ${sessionId}, folderId: ${folderId}`);
            
            // Make API request to API Gateway with the correct parameter format
            const processResponse = await axios.post(
                config.aws.apiGateway.processFolderUrl,
                {
                    folderId
                },
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            console.log('API Gateway process response:', processResponse.data);
            
            // Clear all caches to ensure fresh data after processing
            clearAllCaches();
            
            return res.json({
                success: true,
                message: 'Folder processing initiated successfully',
                data: processResponse.data
            });
        } catch (apiError) {
            console.error('Error calling API Gateway to process folder:', apiError);
            
            // Format error response
            const errorResponse = {
                success: false,
                error: 'Failed to process folder via API Gateway',
                message: apiError.message
            };
            
            // Include response data if available
            if (apiError.response) {
                errorResponse.statusCode = apiError.response.status;
                errorResponse.apiResponse = apiError.response.data;
            }
            
            return res.status(apiError.response?.status || 500).json(errorResponse);
        }
    } catch (error) {
        console.error('Error in process folder endpoint:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

module.exports = router;