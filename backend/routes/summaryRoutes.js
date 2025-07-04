const express = require('express');
const router = express.Router();
const AWS = require('aws-sdk');
const axios = require('axios');
const config = require('../config');

// Configure AWS
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Helper function to get cached data
const getCachedData = (key) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
};

// Helper function to set cached data
const setCachedData = (key, data) => {
  cache.set(key, {
    data,
    timestamp: Date.now()
  });
};

// Helper to get username from session or default
const getUsername = (req) => req.session?.username || 'sri_ganesh';

// Helper to build cache keys
const cacheKey = {
  folders: (username, sessionId) => `folders:${username}:${sessionId}`,
  summary: (username, sessionId, folderName) => folderName ? `summary:${username}:${sessionId}:${folderName}` : `summary:${username}:${sessionId}`,
  apiFolders: (username, sessionId) => `apiFolders:${username}:${sessionId}`,
  sessions: (username) => `sessions:${username}`
};

// Helper function to extract filename from S3 URI
const extractFileName = (s3Uri) => {
  if (!s3Uri) return null;
  try {
    // Handle both s3:// URIs and direct paths
    let path = s3Uri;
    if (s3Uri.startsWith('s3://')) {
      // Remove the s3:// prefix and extract the path after bucket name
      path = s3Uri.replace(/^s3:\/\/[^\/]+\//, '');
    }
    
    // Extract filename from the path, remove chunk information if present
    const fileName = path.split('/').pop();
    
    // Remove chunk references like ::chunk-0, ::chunk-1, ::chunk-2, etc.
    const cleanFileName = fileName.replace(/::chunk-\d+$/, '');
    
    return cleanFileName;
  } catch (error) {
    console.error('Error extracting filename from:', s3Uri, error);
    return null;
  }
};

// Helper function to fetch processed folders from API Gateway
const getProcessedFoldersFromAPI = async (req, username, sessionId) => {
  try {
    const key = cacheKey.apiFolders(username, sessionId);
    if (req.apiResponseCache?.[key]) return req.apiResponseCache[key];
    const cachedData = getCachedData(key);
    if (cachedData) return cachedData;
    const accessToken = req.session?.tokenSet?.access_token;
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    const apiUrl = config.aws.apiGateway.endpoint;
    const response = await axios.get(apiUrl, { headers });
    if (!response.data?.folderMetadata) return [];
    const folders = response.data.folderMetadata
      .filter(f => f.overallStatus === 'folder_summarized')
      .map(f => {
        const parts = f.folderName.split('/');
        const name = parts[parts.length - 1] || parts[parts.length - 2];
        return {
          name,
          path: f.summaryS3Key,
          summaryKey: f.summaryS3Key,
          processed: true,
          lastUpdated: f.lastUpdatedAt
        };
      });
    setCachedData(key, folders);
    req.apiResponseCache = req.apiResponseCache || {};
    req.apiResponseCache[key] = folders;
    return folders;
  } catch (error) {
    console.error('Error fetching folders from API:', error);
    throw error;
  }
};

// Middleware to add request-level cache
router.use((req, res, next) => {
  req.apiResponseCache = {};
  next();
});

// Helper function to parse citations and reconstruct summary data with reference metadata
const parseCitationsToSummary = (rawSummary) => {
  try {
    // If there's no Citations section, return the summary as-is
    if (!rawSummary.Citations || !Array.isArray(rawSummary.Citations)) {
      return rawSummary;
    }

    // Start with the existing summary structure
    const reconstructedSummary = { ...rawSummary };
    
    // Initialize reference metadata for frontend
    reconstructedSummary._referenceMetadata = {};
    
    // Process each citation to extract structured data
    rawSummary.Citations.forEach((citation, index) => {
      if (citation.generatedResponsePart?.textResponsePart?.text) {
        try {
          // Parse the JSON content from the citation text
          const citationData = JSON.parse(citation.generatedResponsePart.textResponsePart.text);
          
          // Extract reference info for this citation
          const citationReferences = citation.retrievedReferences || [];
          
          // Merge the citation data into the reconstructed summary
          Object.keys(citationData).forEach(categoryKey => {
            if (typeof citationData[categoryKey] === 'object' && citationData[categoryKey] !== null) {
              // Initialize category if it doesn't exist
              if (!reconstructedSummary[categoryKey]) {
                reconstructedSummary[categoryKey] = {};
              }
              
              // Merge the subcategory data
              Object.keys(citationData[categoryKey]).forEach(subKey => {
                const value = citationData[categoryKey][subKey];
                // Only update if the citation has actual content (not empty string)
                if (value && value.trim() !== '') {
                  // Map citation keys back to summary keys if needed
                  const mappedKey = mapCitationKeyToSummaryKey(subKey);
                  reconstructedSummary[categoryKey][mappedKey] = value;
                  
                  // Store reference metadata for this field
                  const fieldKey = `${categoryKey}.${mappedKey}`;
                  if (!reconstructedSummary._referenceMetadata[fieldKey]) {
                    reconstructedSummary._referenceMetadata[fieldKey] = [];
                  }
                  
                  // Add reference info for this field
                  citationReferences.forEach(ref => {
                    if (ref.metadata?.original_s3_key) {                      // Handle new bounding box format
                      let boundingBoxes = [];
                      if (ref.metadata.bounding_boxes) {
                        try {
                          // Parse the JSON string containing bounding box array
                          boundingBoxes = JSON.parse(ref.metadata.bounding_boxes);
                        } catch (e) {
                          console.warn('Failed to parse bounding_boxes JSON:', e);
                          boundingBoxes = [];
                        }
                      }
                      
                      reconstructedSummary._referenceMetadata[fieldKey].push({
                        fileName: extractFileName(ref.metadata.original_s3_key),
                        s3Key: ref.metadata.original_s3_key,
                        content: ref.content || 'No content available',
                        pageNumbers: ref.metadata.page_numbers,
                        isPdf: ref.metadata.original_s3_key.toLowerCase().includes('.pdf'),
                        // Store new format bounding boxes
                        boundingBoxes: boundingBoxes,
                        // Keep legacy format for backward compatibility (if present)
                        bbox_left: ref.metadata.bbox_left,
                        bbox_top: ref.metadata.bbox_top,
                        bbox_width: ref.metadata.bbox_width,
                        bbox_height: ref.metadata.bbox_height
                      });
                    }
                  });
                  
                }
              });
            }
          });
        } catch (parseError) {
          console.warn(`Failed to parse citation ${index + 1} as JSON:`, parseError.message);
          
          // Fallback: Try to extract ProductOverview fields from non-JSON citations
          const citationText = citation.generatedResponsePart.textResponsePart.text;
          const citationReferences = citation.retrievedReferences || [];
          
          // Look for ProductOverview fields in plain text
          const productOverviewPatterns = {
            'DrugName': /(?:drug\s+name|product\s+name|medication)[:\s]+([^\n]+)/i,
            'MechanismOfAction': /(?:mechanism\s+of\s+action|moa)[:\s]+([^\n]+)/i,
            'RouteOfAdministration': /(?:route\s+of\s+administration|administration\s+route)[:\s]+([^\n]+)/i,
            'Company': /(?:company|manufacturer|sponsor)[:\s]+([^\n]+)/i
          };
          
          Object.entries(productOverviewPatterns).forEach(([fieldName, pattern]) => {
            const match = citationText.match(pattern);
            if (match && match[1]) {
              // Initialize ProductOverview if it doesn't exist
              if (!reconstructedSummary.ProductOverview) {
                reconstructedSummary.ProductOverview = {};
              }
              
              reconstructedSummary.ProductOverview[fieldName] = match[1].trim();
              
              // Store reference metadata for this field
              const fieldKey = `ProductOverview.${fieldName}`;
              if (!reconstructedSummary._referenceMetadata[fieldKey]) {
                reconstructedSummary._referenceMetadata[fieldKey] = [];
              }
              
              // Add reference info for this field
              citationReferences.forEach(ref => {
                if (ref.metadata?.original_s3_key) {                  // Handle new bounding box format
                  let boundingBoxes = [];
                  if (ref.metadata.bounding_boxes) {
                    try {
                      // Parse the JSON string containing bounding box array
                      boundingBoxes = JSON.parse(ref.metadata.bounding_boxes);
                    } catch (e) {
                      console.warn('Failed to parse bounding_boxes JSON:', e);
                      boundingBoxes = [];
                    }
                  }
                  
                  reconstructedSummary._referenceMetadata[fieldKey].push({
                    fileName: extractFileName(ref.metadata.original_s3_key),
                    s3Key: ref.metadata.original_s3_key,
                    content: ref.content || 'No content available',
                    pageNumbers: ref.metadata.page_numbers,
                    isPdf: ref.metadata.original_s3_key.toLowerCase().includes('.pdf'),
                    // Store new format bounding boxes
                    boundingBoxes: boundingBoxes,
                    // Keep legacy format for backward compatibility (if present)
                    bbox_left: ref.metadata.bbox_left,
                    bbox_top: ref.metadata.bbox_top,
                    bbox_width: ref.metadata.bbox_width,
                    bbox_height: ref.metadata.bbox_height
                  });
                }
              });
              
            }
          });
        }
      }
    });    
    
    return reconstructedSummary;
    
  } catch (error) {
    console.error('Error parsing citations:', error);
    return rawSummary; // Return original on error
  }
};

// Helper function to map citation keys back to summary keys
const mapCitationKeyToSummaryKey = (citationKey) => {
  const mappings = {
    // Efficacy Endpoints
    'EFFICACY_PRIMARY_ENDPOINTS': 'PrimaryEndpoints',
    'EFFICACY_SECONDARY_ENDPOINTS': 'SecondaryEndpoints',
    'EFFICACY_EXPLORATORY_ENDPOINTS': 'ExploratoryEndpoints',
    
    // Attack Rates
    'ATTACK_RATES_MEAN_HAE_PER_MONTH': 'MeanHAEAttacksPerMonth',
    'ATTACK_RATES_LSM_HAE_PER_MONTH': 'LSMHAEAttacksPerMonth',
    'ATTACK_RATES_MEDIAN_HAE_PER_MONTH': 'MedianHAEAttacksPerMonth',
    'ATTACK_RATES_PERCENT_REDUCTION_MEAN_FROM_BASELINE': 'PercentReductionMeanFromBaseline',
    'ATTACK_RATES_PERCENT_REDUCTION_MEDIAN_FROM_BASELINE': 'PercentReductionMedianFromBaseline',
    'ATTACK_RATES_NUMERICAL_REDUCTION_MEAN_FROM_BASELINE': 'NumericalReductionMeanFromBaseline',
    'ATTACK_RATES_PERCENT_PATIENTS_100_REDUCTION_VS_RUNIN': 'PercentPatients100ReductionVsRunIn',
    'ATTACK_RATES_PERCENT_PATIENTS_90_PLUS_REDUCTION': 'PercentPatients90PlusReduction',
    'ATTACK_RATES_PERCENT_PATIENTS_70_PLUS_REDUCTION': 'PercentPatients70PlusReduction',
    'ATTACK_RATES_PERCENT_PATIENTS_50_PLUS_REDUCTION': 'PercentPatients50PlusReduction',
    'ATTACK_RATES_OTHER_TIME_FRAMES': 'AttackRateOtherTimeFrames',
    'ATTACK_RATES_BY_BASELINE_RATE': 'AttackRateByBaselineRate',
    
    // Attack Parameters
    'ATTACK_PARAMETERS_SEVERITY': 'SeverityOfAttacks',
    'ATTACK_PARAMETERS_DURATION': 'DurationOfAttacks',
    'ATTACK_PARAMETERS_DAYS_SWELLING': 'DaysOfSwellingSymptoms',
    'ATTACK_PARAMETERS_TIME_TO_FIRST_ATTACK': 'TimeToFirstAttack',
    'ATTACK_PARAMETERS_BY_LOCATION': 'AttacksByLocation',
    
    // Patient Reported Outcomes
    'PRO_DATA_AE_QOL_CHANGE': 'AEQOLScoreChange',
    'PRO_DATA_PERCENT_GOOD_ON_SGART': 'PercentRatingGoodOnSGART',
    'PRO_DATA_AECT_SCORE_WEEK_25': 'AECTScoreWeek25',
    'PRO_DATA_TSQM_DETAILS': 'TSQMDetails',
    
    // Rescue Medication
    'RESCUE_MED_MEAN_PER_MONTH': 'MeanRescueMedicationsPerMonth',
    'RESCUE_MED_ATTACKS_REQUIRING_RESCUE': 'AttacksPerMonthRequiringRescue',
    
    // PK/PD
    'PK_PD_SUMMARY': 'PKPDDataSummary',
    
    // Additional
    'ADDITIONAL_EXPLORATORY_ENDPOINTS_DETAILS': 'Details',
    'REFERENCES_LIST': 'ReferencesList',
    'FOOTNOTES_LIST': 'FootnotesList'
  };
  
  return mappings[citationKey] || citationKey;
};

// Helper function to fetch summary from S3
const fetchSummaryFromS3 = async (username, sessionId, folderName, summaryKey) => {
  try {
    // If we have a direct summary key path, use it
    if (summaryKey) {
      // Check if summaryKey is an array
      if (Array.isArray(summaryKey)) {

        
        // Initialize an array to store all summaries
        const allSummaries = [];
        
        // Fetch each summary individually
        for (const key of summaryKey) {
          try {
            const params = {
              Bucket: process.env.S3_BUCKET_NAME, // Use environment variable or default bucket name
              Key: key
            };
            
            const data = await s3.getObject(params).promise();
            const rawSummary = JSON.parse(data.Body.toString());
            
            // Process the summary to extract data from citations
            let processedSummary;
            if (Array.isArray(rawSummary)) {
              processedSummary = rawSummary.map(summary => parseCitationsToSummary(summary));
            } else {
              processedSummary = parseCitationsToSummary(rawSummary);
            }
            
            // Add this summary to our collection
            if (Array.isArray(processedSummary)) {
              allSummaries.push(...processedSummary);
            } else {
              allSummaries.push(processedSummary);
            }
            

          } catch (fileError) {
            console.error(`Error fetching summary from key: ${key}`, fileError);
            // Continue with other files even if one fails
          }
        }
        
        if (allSummaries.length === 0) {

          return null;
        }
        
        return allSummaries;
      } else {
        // Handle single key as before

        const params = {
          Bucket: process.env.S3_BUCKET_NAME, // Use environment variable or default bucket name
          Key: summaryKey
        };
        
        const data = await s3.getObject(params).promise();
        const rawSummaries = JSON.parse(data.Body.toString());
        
        // Process the summaries to extract data from citations
        let processedSummaries;
        if (Array.isArray(rawSummaries)) {
          processedSummaries = rawSummaries.map(summary => parseCitationsToSummary(summary));
        } else {
          processedSummaries = parseCitationsToSummary(rawSummaries);
        }
        

        return processedSummaries;
      }
    }
    
    // Otherwise, search for the summary file
    let prefix;
    
    if (folderName) {
      // If folder name is provided, look specifically in that folder
      prefix = `folder-summaries/${username}/${sessionId}/${folderName}/`;
    } else {
      // If no folder is specified, look in the session directory
      prefix = `folder-summaries/${username}/${sessionId}/`;
    }

    // List all objects in the specified directory
    const listParams = {
      Bucket: process.env.S3_BUCKET_NAME, // Use environment variable or default bucket name
      Prefix: prefix
    };


    const listData = await s3.listObjectsV2(listParams).promise();
    
    if (!listData.Contents || listData.Contents.length === 0) {

      return null;
    }

    // Find all JSON files in the directory
    const jsonFiles = listData.Contents.filter(item => item.Key.endsWith('.json'));

    if (jsonFiles.length === 0) {

      return null;
    }

    // Sort by LastModified to get the most recent JSON file
    jsonFiles.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
    const latestJsonFile = jsonFiles[0];



    // Get the content of the most recent summary file
    const params = {
      Bucket: process.env.S3_BUCKET_NAME, // Use environment variable or default bucket name
      Key: latestJsonFile.Key
    };

    const data = await s3.getObject(params).promise();
    const summaries = JSON.parse(data.Body.toString());
    

    return summaries;
  } catch (error) {
    console.error('Error in fetchSummaryFromS3:', error);
    throw error;
  }
};

// Get all folders for a session from API
router.get('/:sessionId/folders', async (req, res) => {
  const { sessionId } = req.params;
  const username = getUsername(req);
  const key = cacheKey.folders(username, sessionId);
  try {
    const cachedData = getCachedData(key);
    if (cachedData) return res.json({ success: true, folders: cachedData });
    const folders = await getProcessedFoldersFromAPI(req, username, sessionId);
    setCachedData(key, folders);
    res.json({ success: true, folders });
  } catch (error) {
    try {
      const listParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Prefix: `folder-summaries/${username}/${sessionId}/`,
        Delimiter: '/'
      };
      const data = await s3.listObjectsV2(listParams).promise();
      const folders = data.CommonPrefixes?.map(prefix => {
        const parts = prefix.Prefix.split('/');
        return { name: parts[parts.length - 2], path: prefix.Prefix, processed: true };
      }) || [];
      res.json({ success: true, folders });
    } catch (s3Error) {
      res.status(500).json({ success: false, message: 'Error listing folders' });
    }
  }
});

// Get summaries for a specific folder in a session
router.get('/:sessionId/folder/:folderName', async (req, res) => {
  const { sessionId, folderName } = req.params;
  const username = getUsername(req);
  const key = cacheKey.summary(username, sessionId, folderName);
  try {
    const cachedData = getCachedData(key);
    if (cachedData) return res.json({ success: true, summaries: cachedData });
    let folder = null;
    const foldersKey = cacheKey.apiFolders(username, sessionId);
    if (req.apiResponseCache?.[foldersKey]) {
      folder = req.apiResponseCache[foldersKey].find(f => f.name === folderName);
    } else {
      const folders = await getProcessedFoldersFromAPI(req, username, sessionId);
      folder = folders.find(f => f.name === folderName);
    }
    const summaries = await fetchSummaryFromS3(username, sessionId, folderName, folder?.summaryKey);
    if (!summaries) return res.status(404).json({ success: false, message: `No summary file found for folder "${folderName}" in session "${sessionId}"` });
    setCachedData(key, summaries);
    res.json({ success: true, summaries });
  } catch (error) {
    if (error.code === 'NoSuchKey') return res.status(404).json({ success: false, message: 'No summary file found for the specified folder' });
    res.status(500).json({ success: false, message: 'Error fetching summaries from S3' });
  }
});

// Get summaries for a session (any folder)
router.get('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const username = getUsername(req);
  const key = cacheKey.summary(username, sessionId);
  try {
    const cachedData = getCachedData(key);
    if (cachedData) return res.json({ success: true, summaries: cachedData });
    const folders = await getProcessedFoldersFromAPI(req, username, sessionId);
    if (folders.length > 0) {
      const folder = folders[0];
      const summaries = await fetchSummaryFromS3(username, sessionId, folder.name, folder.summaryKey);
      if (summaries) {
        setCachedData(key, summaries);
        return res.json({ success: true, summaries });
      }
    }
    const summaries = await fetchSummaryFromS3(username, sessionId);
    if (!summaries) return res.status(404).json({ success: false, message: 'No summary file found for this session' });
    setCachedData(key, summaries);
    res.json({ success: true, summaries });
  } catch (error) {
    if (error.code === 'NoSuchKey') return res.status(404).json({ success: false, message: 'No summary file found for this session' });
    res.status(500).json({ success: false, message: 'Error fetching summaries from S3' });
  }
});

// Refresh summaries for a session
router.post('/:sessionId/refresh', async (req, res) => {
  const { sessionId } = req.params;
  const { folderName } = req.body;
  const username = getUsername(req);
  cache.delete(cacheKey.summary(username, sessionId));
  cache.delete(cacheKey.folders(username, sessionId));
  if (folderName) cache.delete(cacheKey.summary(username, sessionId, folderName));
  try {
    const folders = await getProcessedFoldersFromAPI(req, username, sessionId);
    let summaryKey = null;
    if (folderName) {
      const folder = folders.find(f => f.name === folderName);
      if (folder) summaryKey = folder.summaryKey;
    } else if (folders.length > 0) {
      summaryKey = folders[0].summaryKey;
    }
    const summaries = await fetchSummaryFromS3(username, sessionId, folderName, summaryKey);
    if (!summaries) return res.status(404).json({ success: false, message: 'No summary file found for the specified session/folder' });
    res.json({ success: true, summaries });
  } catch (error) {
    if (error.code === 'NoSuchKey') return res.status(404).json({ success: false, message: 'No summary file found for the specified session/folder' });
    res.status(500).json({ success: false, message: 'Error refreshing summaries from S3' });
  }
});

// List all user sessions
router.get('/sessions', async (req, res) => {
  const username = getUsername(req);
  const key = cacheKey.sessions(username);
  try {
    const cachedData = getCachedData(key);
    if (cachedData) return res.json({ success: true, sessions: cachedData });
    try {
      const accessToken = req.session?.tokenSet?.access_token;
      const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
      const apiUrl = config.aws.apiGateway.myfilesUrl;
      const response = await axios.get(apiUrl, { headers });
      if (response.data?.folderMetadata) {
        const sessionsMap = new Map();
        response.data.folderMetadata.forEach(folder => {
          if (folder.folderName) {
            const sessionId = folder.folderName.split('/')[0];
            if (sessionId && !sessionsMap.has(sessionId)) {
              sessionsMap.set(sessionId, { id: sessionId, lastUpdated: folder.lastUpdatedAt || '' });
            }
          }
        });
        const sessions = Array.from(sessionsMap.values()).sort((a, b) => {
          if (!a.lastUpdated) return 1;
          if (!b.lastUpdated) return -1;
          return new Date(b.lastUpdated) - new Date(a.lastUpdated);
        });
        setCachedData(key, sessions);
        return res.json({ success: true, sessions });
      }
    } catch (apiError) { /* fallback to S3 */ }
    const listParams = {
      Bucket: process.env.S3_BUCKET_NAME,
      Prefix: `folder-summaries/${username}/`,
      Delimiter: '/'
    };
    const data = await s3.listObjectsV2(listParams).promise();
    const sessions = data.CommonPrefixes?.map(prefix => {
      const parts = prefix.Prefix.split('/');
      return { id: parts[parts.length - 2], path: prefix.Prefix };
    }) || [];
    setCachedData(key, sessions);
    res.json({ success: true, sessions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error listing sessions' });
  }
});

module.exports = router;