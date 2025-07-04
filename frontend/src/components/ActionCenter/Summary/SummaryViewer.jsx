import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import SummaryDisplay from './SummaryDisplay';
import SummaryTableView from './SummaryTableView';
import './SummaryViewer.css';

const SummaryViewer = () => {
    const [summaryFiles, setSummaryFiles] = useState([]);
    const [selectedSummaries, setSelectedSummaries] = useState([]);
    const [summaryDataMap, setSummaryDataMap] = useState({});
    const [viewMode, setViewMode] = useState('table'); // 'table' or 'detail'
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    // Fetch list of summary files
    useEffect(() => {
        const fetchSummaryFiles = async () => {
            try {
                setIsLoading(true);
                
                // Get the current session ID from the URL if available
                const pathParts = window.location.pathname.split('/');
                const sessionIndex = pathParts.findIndex(part => part === 'summaries');
                const sessionId = sessionIndex >= 0 && pathParts.length > sessionIndex + 1 
                    ? pathParts[sessionIndex + 1]
                    : 'latest'; // Default to 'latest' if no session ID is found
                
                // Fetch folders for the current session
                const foldersResponse = await axios.get(`/api/summaries/${sessionId}/folders`);
                
                if (foldersResponse.data && foldersResponse.data.success && foldersResponse.data.folders) {
                    // Transform folders data into files format
                    const files = foldersResponse.data.folders.map(folder => ({
                        key: folder.name,
                        name: folder.name,
                        path: folder.path
                    }));
                    
                    setSummaryFiles(files);
                    
                    // Preselect first folder if available
                    if (files.length > 0) {
                        handleSelectSummary(files[0].key);
                    }
                } else {
                    console.warn('No folders found or invalid response format');
                }
                
                setIsLoading(false);
            } catch (err) {
                console.error('Error fetching summary files:', err);
                setError('Failed to fetch summary files: ' + (err.response?.data?.message || err.message));
                setIsLoading(false);
            }
        };        fetchSummaryFiles();
    }, [handleSelectSummary]);// Load summary data when a file is selected
    const handleSelectSummary = useCallback(async (fileKey) => {
        // Check if already selected
        if (selectedSummaries.includes(fileKey)) {
            // If already selected, deselect it
            setSelectedSummaries(selectedSummaries.filter(key => key !== fileKey));
            return;
        }
        
        try {
            setIsLoading(true);
            
            // Add to selected summaries
            setSelectedSummaries([...selectedSummaries, fileKey]);
            
            // If data already loaded, don't fetch again
            if (summaryDataMap[fileKey]) {
                setIsLoading(false);
                return;
            }
            
            // Get the current session ID from the URL if available
            const pathParts = window.location.pathname.split('/');
            const sessionIndex = pathParts.findIndex(part => part === 'summaries');
            const sessionId = sessionIndex >= 0 && pathParts.length > sessionIndex + 1 
                ? pathParts[sessionIndex + 1]
                : 'latest'; // Default to 'latest' if no session ID is found
            
            // Fetch summary data for the selected folder
            const response = await axios.get(`/api/summaries/${sessionId}/folder/${fileKey}`);
            
            if (response.data && response.data.success && response.data.summaries) {
                // Add data to the map
                setSummaryDataMap({
                    ...summaryDataMap,
                    [fileKey]: response.data.summaries
                });
            } else {
                setError('Failed to fetch summary data: Invalid response format');
            }
            
            setIsLoading(false);
        } catch (err) {
            console.error('Error fetching summary data:', err);
            setError('Failed to fetch summary data: ' + (err.response?.data?.message || err.message));
            setIsLoading(false);
        }
    }, [selectedSummaries, summaryDataMap]);

    // Format file name for display
    const formatFileName = (fileName) => {
        // Remove file extension
        let name = fileName.replace(/\.[^/.]+$/, "");
        
        // Replace underscores with spaces
        name = name.replace(/_/g, " ");
        
        // Limit length and add ellipsis if too long
        if (name.length > 50) {
            return name.substring(0, 47) + '...';        }
        
        return name;
    };

    // Get selected summaries data
    const getSelectedSummariesData = () => {
        return selectedSummaries.map(key => summaryDataMap[key]).filter(Boolean);
    };

    return (
        <div className="summary-viewer">
            <div className="summary-sidebar">
                <h2>Available Summaries</h2>
                <div className="view-mode-toggle">
                    <button 
                        className={viewMode === 'table' ? 'active' : ''} 
                        onClick={() => setViewMode('table')}
                    >
                        Table View
                    </button>
                    <button 
                        className={viewMode === 'detail' ? 'active' : ''} 
                        onClick={() => setViewMode('detail')}
                    >
                        Detail View
                    </button>
                </div>
                
                {isLoading && summaryFiles.length === 0 && (
                    <div className="loading-indicator">Loading summaries...</div>
                )}
                {error && (
                    <div className="error-message">{error}</div>
                )}
                <ul className="summary-list">
                    {summaryFiles.map((file, index) => (
                        <li 
                            key={index} 
                            className={selectedSummaries.includes(file.key) ? 'selected' : ''}
                            onClick={() => handleSelectSummary(file.key)}
                        >
                            {formatFileName(file.name)}
                        </li>
                    ))}
                </ul>
                {viewMode === 'table' && (
                    <div className="selection-instructions">
                        Select multiple summaries to compare in table view
                    </div>
                )}
            </div>
            <div className="summary-content">
                {isLoading && selectedSummaries.length > 0 && Object.keys(summaryDataMap).length === 0 && (
                    <div className="loading-indicator">Loading summary data...</div>
                )}                {viewMode === 'table' ? (
                    <SummaryTableView summaries={getSelectedSummariesData()} />
                ) : (
                    selectedSummaries.length > 0 && summaryDataMap[selectedSummaries[0]] && (
                        <SummaryDisplay summaryData={summaryDataMap[selectedSummaries[0]]} />
                    )
                )}
                {selectedSummaries.length === 0 && !isLoading && (
                    <div className="no-selection-message">
                        {viewMode === 'table' 
                            ? 'Select summaries from the list to compare' 
                            : 'Select a summary from the list to view details'}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SummaryViewer; 