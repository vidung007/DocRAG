import React from 'react';
import './SummaryDisplay.css';

const SummaryDisplay = ({ summaryData }) => {
    if (!summaryData) {
        return <div className="summary-display-loading">Loading summary...</div>;
    }

    const { 
        ProductOverview, 
        StudyDetails,
        EfficacyEndpoints,
        AttackRates,
        RescueMedicationUse,
        AttackParameters,
        PatientReportedOutcomes,
        PharmacokineticsPharmacodynamics,
        AdditionalExploratoryEndpointsDetails,
        ReferencesAndFootnotes
    } = summaryData;

    // Helper function to display data only if it's available and not a "No data" message
    const displayIfAvailable = (value) => {
        if (!value || value.includes("No data available") || value === "N/A") {
            return <span className="no-data">No data available</span>;
        }
        return value;
    };

    // Helper function to render a section with title and key-value pairs
    const renderSection = (title, dataObj) => {
        if (!dataObj || Object.keys(dataObj).length === 0) return null;
        
        return (
            <section className="summary-section">
                <h2>{title}</h2>
                {Object.entries(dataObj).map(([key, value]) => {
                    // Skip empty objects or arrays
                    if (typeof value === 'object' && (Object.keys(value).length === 0 || value.length === 0)) {
                        return null;
                    }
                    
                    // Format the key for display (convert camelCase to spaces)
                    const formattedKey = key
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/^./, str => str.toUpperCase());
                    
                    return (
                        <p key={key}>
                            <strong>{formattedKey}:</strong> {displayIfAvailable(value)}
                        </p>
                    );
                })}
            </section>
        );
    };

    // Render citations if present
    const renderCitations = (citations) => {

        if (!citations || !Array.isArray(citations) || citations.length === 0) {
            return <div className="no-citations">No citations found in this summary.</div>;
        }
        return (
            <section className="summary-section citations-section">
                <h2>Citations</h2>
                {citations.map((citation, idx) => (
                    <div key={idx} className="citation-block">
                        <div className="citation-text">
                            <strong>Citation {idx + 1}:</strong> {citation.generatedResponsePart?.textResponsePart?.text}
                        </div>
                        {citation.retrievedReferences && citation.retrievedReferences.length > 0 && (
                            <div className="citation-references">
                                {citation.retrievedReferences.map((ref, refIdx) => (
                                    <div key={refIdx} className="reference">
                                        <strong>Reference:</strong> {ref.content?.text}
                                        {ref.location?.s3Location?.uri && (
                                            <div className="reference-uri">
                                                <a href={ref.location.s3Location.uri} target="_blank" rel="noopener noreferrer">
                                                    View Source
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </section>
        );
    };

    return (
        <div className="summary-display">
            {renderSection("Product Overview", ProductOverview)}
            {renderSection("Study Details", StudyDetails)}
            {renderSection("Efficacy Endpoints", EfficacyEndpoints)}
            {renderSection("Attack Rates", AttackRates)}
            {renderSection("Rescue Medication Use", RescueMedicationUse)}
            {renderSection("Attack Parameters", AttackParameters)}
            {renderSection("Patient Reported Outcomes", PatientReportedOutcomes)}
            {renderSection("Pharmacokinetics & Pharmacodynamics", PharmacokineticsPharmacodynamics)}
            {renderSection("Additional Exploratory Endpoints", AdditionalExploratoryEndpointsDetails)}
            {renderSection("References & Footnotes", ReferencesAndFootnotes)}
            {renderCitations(summaryData.Citations)}
        </div>
    );
};

export default SummaryDisplay;