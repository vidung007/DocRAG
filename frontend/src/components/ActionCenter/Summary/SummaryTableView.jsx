import React, { useEffect, useMemo, useState } from 'react';
import './SummaryTableView.css';
import { DRUG_CATEGORIES, TRIAL_METADATA_CATEGORIES, DRUG_SUBCATEGORIES } from './DrugDataCategories';
import PDFHighlighter from './PDFHighlighter';
import ReferencePopup from './ReferencePopup';
import * as XLSX from 'xlsx';

// Reference Indicator Component
const ReferenceIndicator = ({ count, hasMultipleFiles, onClick }) => {
  if (count === 0) return null;
  
  return (
    <span 
      className="reference-indicator"
      onClick={onClick}
      title={`${count} reference${count > 1 ? 's' : ''} found${hasMultipleFiles ? ' (multiple files)' : ''}`}
    >
      📄
    </span>
  );
};

const SummaryTableView = ({ summaries }) => {
  const [highlightedFileInfo, setHighlightedFileInfo] = useState(null);
  const [pdfViewerState, setPdfViewerState] = useState(null);
  const [referencePopupData, setReferencePopupData] = useState(null);
  const [currentPage, setCurrentPage] = useState(1); // Add pagination state
  
  // Debug: Log the structure of received data
  useEffect(() => {
    console.log('=== SummaryTableView Debug ===');
    console.log('Received summaries:', summaries);
    if (summaries && summaries.length > 0) {
      console.log('First summary structure:', summaries[0]);
      console.log('Has __citations__:', !!summaries[0].__citations__);
      console.log('Has _referenceMetadata:', !!summaries[0]._referenceMetadata);
      if (summaries[0].__citations__) {
        console.log('Citations structure:', summaries[0].__citations__);
      }
      if (summaries[0]._referenceMetadata) {
        console.log('Reference metadata structure:', summaries[0]._referenceMetadata);
      }
    }
    console.log('=== End Debug ===');
  }, [summaries]);

  const groupedSummaries = useMemo(() => {
    if (!summaries || summaries.length === 0) return [];
    const groups = {};
    summaries.forEach(summary => {
      const drugName = summary.ProductOverview?.DrugName || 'Unnamed Drug';
      const company = summary.ProductOverview?.Company || 'Unknown Company';
      const key = `${drugName}_${company}`;
      if (!groups[key]) {
        groups[key] = {
          key,
          drugName,
          company,
          studies: []
        };
      }
      groups[key].studies.push(summary);
    });
    Object.values(groups).forEach(group => {
      group.studies.sort((a, b) => {
        const aType = a.StudyDetails?.StudyType || '';
        const bType = b.StudyDetails?.StudyType || '';
        return aType.localeCompare(bType);
      });
    });
    return Object.values(groups);
  }, [summaries]);
  const categories = useMemo(() => {
    return Object.keys(DRUG_CATEGORIES)
      .filter(categoryKey => categoryKey !== 'ProductOverview')
      .map(categoryKey => ({
        id: categoryKey,
        name: DRUG_CATEGORIES[categoryKey],
        subcategories: Object.keys(DRUG_SUBCATEGORIES)
          .filter(subKey => {
            // Existing filter logic to map subcategories to their parent categories
            if (categoryKey === 'StudyDetails') {
              return ['StudyType', 'ClinicalTrialRegistryNumber', 'StudyDesign', 'EligibilityCriteria', 'TrialDurationWeeks', 'NumberOfPatients', 'StudyStatus', 'LongTermStudyDetails'].includes(subKey);
            }
            if (categoryKey === 'EfficacyEndpoints') {
              return ['PrimaryEndpoints', 'SecondaryEndpoints', 'ExploratoryEndpoints'].includes(subKey);
            }
            if (categoryKey === 'AttackRates') {
              return ['MeanHAEAttacksPerMonth', 'LSMHAEAttacksPerMonth', 'MedianHAEAttacksPerMonth', 'PercentReductionMeanActiveVsPlacebo', 'PercentReductionLSMActiveVsPlacebo', 'PercentReductionMedianActiveVsPlacebo', 'PercentReductionMeanFromBaseline', 'PercentReductionMedianFromBaseline', 'NumericalReductionMeanFromBaseline', 'PercentPatients100ReductionVsRunIn', 'PercentPatients90PlusReduction', 'PercentPatients70PlusReduction', 'PercentPatients50PlusReduction', 'AttackRateOtherTimeFrames', 'AttackRateByBaselineRate'].includes(subKey);
            }
            if (categoryKey === 'RescueMedicationUse') {
              return ['MeanRescueMedicationsPerMonth', 'AttacksPerMonthRequiringRescue'].includes(subKey);
            }
            if (categoryKey === 'AttackParameters') {
              return ['SeverityOfAttacks', 'DurationOfAttacks', 'DaysOfSwellingSymptoms', 'TimeToFirstAttack', 'AttacksByLocation'].includes(subKey);
            }
            if (categoryKey === 'PatientReportedOutcomes') {
              return ['AEQOLScoreChange', 'PercentRatingGoodOnSGART', 'AECTScoreWeek25', 'TSQMDetails'].includes(subKey);
            }
            if (categoryKey === 'PharmacokineticsPharmacodynamics') {
              return ['PKPDDataSummary'].includes(subKey);
            }
            if (categoryKey === 'AdditionalExploratoryEndpointsDetails') {
              return ['Details'].includes(subKey);
            }
            if (categoryKey === 'ReferencesAndFootnotes') {
              return ['ReferencesList', 'FootnotesList'].includes(subKey);
            }
            return false;
          })
          .map(subKey => ({ id: subKey, name: DRUG_SUBCATEGORIES[subKey] }))
      }));
  }, []);

  // Trial Metadata categories for page 2
  const trialMetadataCategories = useMemo(() => {
    return Object.keys(TRIAL_METADATA_CATEGORIES).map(categoryKey => ({
      id: categoryKey,
      name: TRIAL_METADATA_CATEGORIES[categoryKey],
      subcategories: Object.keys(DRUG_SUBCATEGORIES)        .filter(subKey => {          if (categoryKey === 'TrialAndProduct') {
            return ['NCT', 'TrialName', 'ProductName', 'StartDate', 'EndDate', 'MechanismOfAction'].includes(subKey);
          }
          if (categoryKey === 'PatientCriteria') {
            return ['Age', 'HAESubtype', 'GeographicalLocation', 'SexRestriction', 'EthnicityRaceRestriction', 'OtherRelevantRestriction'].includes(subKey);
          }
          if (categoryKey === 'Documentation') {
            return ['References', 'Footnotes'].includes(subKey);
          }
          return false;
        })
        .map(subKey => ({ id: subKey, name: DRUG_SUBCATEGORIES[subKey] }))
    }));
  }, []);

  // Simple helper functions
  const renderAsPlainText = (text) => {
    if (!text || typeof text !== 'string') return 'Not specified';
    return text;
  };

  const formatDose = (dose) => {
    if (!dose) return 'Not specified';
    return <span dangerouslySetInnerHTML={{ __html: dose.replace(/\n/g, '<br>') }} />;
  };  // Get reference info from backend-processed metadata or citations
  const getFieldReferenceInfo = (study, categoryId, subcategoryId) => {
    // Check if field has data
    let cellHasData = false;
    let fieldValue = null;

    if (categoryId === 'ProductOverview') {
      fieldValue = study.ProductOverview?.[subcategoryId];
      cellHasData = fieldValue && fieldValue !== 'Not specified';
    } else if (categoryId === 'TrialAndProduct' || categoryId === 'PatientCriteria' || categoryId === 'Documentation') {
      // Handle trial metadata
      fieldValue = study.trialMetadataSummary?.[subcategoryId];
      cellHasData = fieldValue && fieldValue !== 'Not specified';
    } else {
      fieldValue = study[categoryId]?.[subcategoryId];
      cellHasData = fieldValue && fieldValue !== 'Not specified';
    }

    if (!cellHasData) {
      return { count: 0, files: [], hasMultipleFiles: false };
    }

    // First try to get references from backend-processed metadata
    const fieldKey = `${categoryId}.${subcategoryId}`;
    let references = study._referenceMetadata?.[fieldKey] || [];    // If no references found in metadata, try to extract from citations
    if (references.length === 0 && study.__citations__) {
      console.log(`Getting references for ${categoryId}.${subcategoryId} from citations`);
      references = extractReferencesFromCitations(study.__citations__, categoryId, subcategoryId);
    }
    
    const uniqueFiles = new Set(references.map(ref => ref.fileName).filter(Boolean));
    
    console.log(`Field ${categoryId}.${subcategoryId}: ${references.length} references, ${uniqueFiles.size} unique files`);
    
    return {
      count: references.length,
      files: Array.from(uniqueFiles),
      hasMultipleFiles: uniqueFiles.size > 1
    };
  };  // Extract references from new citations format
  const extractReferencesFromCitations = (citations, categoryId, subcategoryId) => {
    const allReferences = [];
    
    // Since citations are not field-specific in your data format, 
    // we'll return all available citations for any field that has data
    Object.values(citations).forEach(citationArray => {
      if (Array.isArray(citationArray)) {
        citationArray.forEach(citation => {
          if (citation.retrievedReferences) {
            citation.retrievedReferences.forEach(ref => {
              // Create reference object compatible with existing format
              const referenceObj = {
                content: ref.content?.text || ref.content || 'No content available',
                fileName: ref.metadata?.file_name || 'Unknown file',
                s3Key: ref.metadata?.original_s3_key || '',
                pageNumbers: ref.metadata?.page_numbers || '',
                boundingBoxes: ref.metadata?.bounding_boxes || null,
                bbox_left: ref.metadata?.bbox_left,
                bbox_top: ref.metadata?.bbox_top,
                bbox_width: ref.metadata?.bbox_width,
                bbox_height: ref.metadata?.bbox_height
              };
              
              allReferences.push(referenceObj);
            });
          }
        });
      }
    });
    
    console.log(`Extracted ${allReferences.length} references for ${categoryId}.${subcategoryId}:`, allReferences);
    return allReferences;
  };
  // Get source files for a study using backend metadata and citations
  const getSourceFilesForStudy = (study) => {
    const fileNames = new Set();
    
    // Get files from backend metadata
    if (study._referenceMetadata) {
      Object.values(study._referenceMetadata).forEach(references => {
        references.forEach(ref => {
          if (ref.fileName) {
            fileNames.add(ref.fileName);
          }
        });
      });
    }
    
    // Also get files from citations
    if (study.__citations__) {
      Object.values(study.__citations__).forEach(citationArray => {
        if (Array.isArray(citationArray)) {
          citationArray.forEach(citation => {
            if (citation.retrievedReferences) {
              citation.retrievedReferences.forEach(ref => {
                if (ref.metadata?.file_name) {
                  fileNames.add(ref.metadata.file_name);
                }
              });
            }
          });
        }
      });
    }
    
    return Array.from(fileNames).sort();
  };

  // Get fields that came from a specific file
  const getFieldsFromFile = (study, targetFileName) => {
    const fieldsFromFile = new Set();
    
    if (study._referenceMetadata) {
      Object.entries(study._referenceMetadata).forEach(([fieldKey, references]) => {
        if (references.some(ref => ref.fileName === targetFileName)) {
          // Backend creates keys like "CategoryName.SubcategoryName" 
          // We need the subcategory part for comparison
          const parts = fieldKey.split('.');
          if (parts.length >= 2) {
            const field = parts[parts.length - 1]; // Get the last part (subcategory)
            fieldsFromFile.add(field);
          } else {
            // Fallback for single-level keys
            fieldsFromFile.add(fieldKey);
          }
        }
      });
    }
    
    return fieldsFromFile;
  };  // File click handler for highlighting
  const handleFileClick = (fileName, studyKey) => {
    const currentHighlight = highlightedFileInfo?.fileName === fileName && highlightedFileInfo?.studyKey === studyKey;
    
    if (currentHighlight) {
      setHighlightedFileInfo(null);
    } else {      setHighlightedFileInfo({ fileName, studyKey });
    }
  };

  // Check if cell should be highlighted
  const shouldHighlightCell = (category, subcategory, study, studyKey) => {
    if (!highlightedFileInfo || studyKey !== highlightedFileInfo.studyKey) return false;
    
    const fieldsFromFile = getFieldsFromFile(study, highlightedFileInfo.fileName);
    return fieldsFromFile.has(subcategory.id);
  };  // Handle reference popup
  const handleShowReferencePopup = (category, subcategory, study) => {
    console.log(`=== Reference Popup Debug ===`);
    console.log(`Field: ${category.id}.${subcategory.id}`);
    console.log(`Category:`, category);
    console.log(`Subcategory:`, subcategory);
    console.log(`Study:`, study);
    
    // Backend creates keys like "CategoryName.SubcategoryName"
    const fieldKey = `${category.id}.${subcategory.id}`;
    let references = study._referenceMetadata?.[fieldKey] || [];
    console.log(`References from metadata:`, references);

    // If no references found in metadata, try to extract from citations
    if (references.length === 0 && study.__citations__) {
      console.log(`Extracting references from citations...`);
      references = extractReferencesFromCitations(study.__citations__, category.id, subcategory.id);
    }

    console.log(`Final references:`, references);

    if (references.length === 0) {
      console.log(`No references found for field: ${subcategory.name}`);
      alert(`No references found for field: ${subcategory.name}`);
      return;
    }setReferencePopupData({
      fieldInfo: {
        fieldLabel: `${category.name} - ${subcategory.name}`,
        categoryId: category.id,
        subcategoryId: subcategory.id
      },      
      references: references.map(ref => ({
        content: {
          text: ref.content || 'No content preview available'
        },
        metadata: {
          original_s3_key: ref.s3Key,
          page_numbers: ref.pageNumbers,
          // Handle new bounding box format
          bounding_boxes: ref.boundingBoxes,
          // Include legacy bbox coordinates for backward compatibility
          bbox_left: ref.bbox_left,
          bbox_top: ref.bbox_top,
          bbox_width: ref.bbox_width,          
          bbox_height: ref.bbox_height,
          // Add file name to metadata for the popup
          file_name: ref.fileName
        },
        fileName: ref.fileName
      })),
      study: study
    });
  };

  // Handle PDF opening
  const handleOpenPDFFromPopup = (pdfInfo) => {
    let processedPdfUrl = pdfInfo.pdfUrl;
    
    if (pdfInfo.pdfUrl.startsWith('s3://')) {
      const s3Match = pdfInfo.pdfUrl.match(/^s3:\/\/([^/]+)\/(.+)$/);
      if (s3Match) {
        const [, bucket, key] = s3Match;
        processedPdfUrl = `${process.env.REACT_APP_BACKEND_URL}/api/temp-pdf/view/${bucket}/${key}`;
      }
    }    // Extract bbox highlights from the PDF info
    let bboxHighlights = pdfInfo.bboxHighlights || [];
    
    // Fallback: if no bbox highlights in pdfInfo, try to extract from metadata
    if (bboxHighlights.length === 0 && pdfInfo.metadata) {
      const metadata = pdfInfo.metadata;
      
      // Check for new format bounding boxes
      if (metadata.bounding_boxes) {
        try {
          // Parse bounding boxes - they might already be parsed or be a string
          let boundingBoxes;
          if (typeof metadata.bounding_boxes === 'string') {
            boundingBoxes = JSON.parse(metadata.bounding_boxes);
          } else {
            boundingBoxes = metadata.bounding_boxes;
          }
          
          bboxHighlights = boundingBoxes.map(bbox => ({
            page: bbox.page,
            bbox_left: bbox.left,
            bbox_top: bbox.top,
            bbox_width: bbox.width,
            bbox_height: bbox.height,
            color: 'rgba(255, 255, 0, 0.4)'
          }));
        } catch (e) {
          console.warn('Failed to parse bounding_boxes format:', e);
        }
      }
      
      // Fallback to legacy format
      if (bboxHighlights.length === 0 && metadata.bbox_left !== undefined && metadata.bbox_top !== undefined) {
        bboxHighlights.push({
          bbox_left: parseFloat(metadata.bbox_left),
          bbox_top: parseFloat(metadata.bbox_top),
          bbox_width: parseFloat(metadata.bbox_width || 0.1),          
          bbox_height: parseFloat(metadata.bbox_height || 0.05),
          color: 'rgba(255, 255, 0, 0.4)'
        });
      }
    }

    setPdfViewerState({
      pdfUrl: processedPdfUrl,
      pageNumber: pdfInfo.pageNumber || 1,
      bboxHighlights: bboxHighlights,
      citationPageNumbers: pdfInfo.citationPageNumbers,
      fileName: pdfInfo.fileName
    });  };  // Excel Export Function
  const exportToExcel = () => {
    if (!summaries || summaries.length === 0) {
      alert('No data to export');
      return;
    }

    const workbook = XLSX.utils.book_new();
    
    // Create intelligent product grouping based on identical product overview
    const productGroups = {};
    summaries.forEach((study, index) => {
      const productKey = JSON.stringify({
        drugName: study.ProductOverview?.DrugName || 'Unknown Drug',
        company: study.ProductOverview?.Company || 'Unknown Company',
        mechanism: study.ProductOverview?.MechanismOfAction || 'Not specified',
        route: study.ProductOverview?.RouteOfAdministration || 'Not specified'
      });
      
      if (!productGroups[productKey]) {
        productGroups[productKey] = {
          productInfo: study.ProductOverview,
          studies: []
        };
      }
      
      productGroups[productKey].studies.push({
        ...study,
        studyIndex: index,
        studyType: study.StudyDetails?.StudyType || 'Unknown Study Type'
      });
    });
    
    // Page 1: Clinical Data
    const clinicalData = [];
    
    // Title
    clinicalData.push(['🏥 CLINICAL DATA SUMMARY - INTELLIGENT PRODUCT GROUPING']);
    clinicalData.push([]);
    
    // Product Overview Section
    clinicalData.push(['📋 PRODUCT OVERVIEW & STUDY TYPES']);
    clinicalData.push([]);
    
    Object.entries(productGroups).forEach(([productKey, group], groupIndex) => {
      const product = group.productInfo;
      
      // Product header
      clinicalData.push([`PRODUCT ${groupIndex + 1}: ${product?.DrugName || 'Unknown Drug'}`]);
      clinicalData.push(['  Company:', product?.Company || 'Not specified']);
      clinicalData.push(['  Mechanism of Action:', product?.MechanismOfAction || 'Not specified']);
      clinicalData.push(['  Route of Administration:', product?.RouteOfAdministration || 'Not specified']);
      clinicalData.push(['  Study Types in this Product:']);
      
      // List study types under this product
      group.studies.forEach((study, studyIndex) => {
        clinicalData.push([`    ${studyIndex + 1}. ${study.studyType}`]);
      });
      clinicalData.push([]);
    });
    
    // Data comparison headers
    clinicalData.push(['📊 DETAILED COMPARISON DATA']);
    clinicalData.push([]);
    
    const headers = ['Category', 'Field'];
    Object.entries(productGroups).forEach(([productKey, group]) => {
      group.studies.forEach((study) => {
        const drugName = study.ProductOverview?.DrugName || 'Unknown Drug';
        headers.push(`${drugName} (${study.studyType})`);
      });
    });
    clinicalData.push(headers);

    // Clinical data categories
    categories.forEach((category) => {
      // Category header row
      const totalStudies = Object.values(productGroups).reduce((acc, group) => acc + group.studies.length, 0);
      clinicalData.push([`📋 ${category.name.toUpperCase()}`, '', ...new Array(totalStudies).fill('')]);
      
      category.subcategories.forEach((subcategory) => {
        const row = ['', subcategory.name];
        
        Object.entries(productGroups).forEach(([productKey, group]) => {
          group.studies.forEach((study) => {
            const data = study[category.id]?.[subcategory.id];
            let displayData = data || 'Not specified';
            
            // Clean and format data
            if (typeof displayData === 'string') {
              displayData = displayData.replace(/<[^>]*>/g, '').replace(/\n/g, ' ').trim();
              if (displayData.length > 400) {
                displayData = displayData.substring(0, 397) + '...';
              }
            }
            
            row.push(displayData);
          });
        });
        
        clinicalData.push(row);
      });
      clinicalData.push([]); // Empty row between categories
    });
    
    // Reference Files Section
    clinicalData.push(['📁 REFERENCE FILES BY STUDY']);
    clinicalData.push([]);
    
    Object.entries(productGroups).forEach(([productKey, group]) => {
      const drugName = group.productInfo?.DrugName || 'Unknown Drug';
      clinicalData.push([`PRODUCT: ${drugName}`]);
      
      group.studies.forEach((study, studyIndex) => {
        const sourceFiles = getSourceFilesForStudy(study);
        clinicalData.push([`  📄 ${study.studyType}:`, sourceFiles.join('; ')]);
      });
      clinicalData.push([]);
    });

    const clinicalWorksheet = XLSX.utils.aoa_to_sheet(clinicalData);
    
    // Enhanced column widths
    const clinicalColWidths = [{ wch: 30 }, { wch: 40 }]; // Category, Field
    Object.entries(productGroups).forEach(([productKey, group]) => {
      group.studies.forEach(() => {
        clinicalColWidths.push({ wch: 50 }); // Study columns
      });
    });
    clinicalWorksheet['!cols'] = clinicalColWidths;
    
    // Enhanced formatting
    const clinicalRange = XLSX.utils.decode_range(clinicalWorksheet['!ref']);
    for (let row = clinicalRange.s.r; row <= clinicalRange.e.r; row++) {
      for (let col = clinicalRange.s.c; col <= clinicalRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!clinicalWorksheet[cellAddress]) continue;
        
        const cellValue = clinicalWorksheet[cellAddress].v;
        if (cellValue && typeof cellValue === 'string') {
          // Style main headers
          if (cellValue.includes('🏥') || cellValue.includes('📋') || cellValue.includes('📊') || cellValue.includes('📁')) {
            clinicalWorksheet[cellAddress].s = {
              font: { bold: true, size: 14, color: { rgb: "0969DA" } },
              fill: { fgColor: { rgb: "F0F8FF" } }
            };
          }
          // Style product headers
          else if (cellValue.startsWith('PRODUCT ') && cellValue.includes(':')) {
            clinicalWorksheet[cellAddress].s = {
              font: { bold: true, size: 12, color: { rgb: "6F42C1" } },
              fill: { fgColor: { rgb: "F3E8FF" } }
            };
          }
          // Style category headers
          else if (cellValue.startsWith('📋 ') && col === 0) {
            clinicalWorksheet[cellAddress].s = {
              font: { bold: true, size: 11 },
              fill: { fgColor: { rgb: "E9ECEF" } }
            };
          }
        }
      }
    }

    XLSX.utils.book_append_sheet(workbook, clinicalWorksheet, 'Clinical Data');

    // Page 2: Trial Metadata (similar structure)
    const metadataData = [];
    
    // Title
    metadataData.push(['🔬 TRIAL METADATA SUMMARY - INTELLIGENT PRODUCT GROUPING']);
    metadataData.push([]);
    
    // Product Overview Section (same as clinical data)
    metadataData.push(['📋 PRODUCT OVERVIEW & STUDY TYPES']);
    metadataData.push([]);
    
    Object.entries(productGroups).forEach(([productKey, group], groupIndex) => {
      const product = group.productInfo;
      
      metadataData.push([`PRODUCT ${groupIndex + 1}: ${product?.DrugName || 'Unknown Drug'}`]);
      metadataData.push(['  Company:', product?.Company || 'Not specified']);
      metadataData.push(['  Mechanism of Action:', product?.MechanismOfAction || 'Not specified']);
      metadataData.push(['  Route of Administration:', product?.RouteOfAdministration || 'Not specified']);
      metadataData.push(['  Study Types in this Product:']);
      
      group.studies.forEach((study, studyIndex) => {
        metadataData.push([`    ${studyIndex + 1}. ${study.studyType}`]);
      });
      metadataData.push([]);
    });
    
    // Data comparison headers
    metadataData.push(['📊 DETAILED TRIAL METADATA COMPARISON']);
    metadataData.push([]);
    
    const metadataHeaders = ['Category', 'Field'];
    Object.entries(productGroups).forEach(([productKey, group]) => {
      group.studies.forEach((study) => {
        const drugName = study.ProductOverview?.DrugName || 'Unknown Drug';
        metadataHeaders.push(`${drugName} (${study.studyType})`);
      });
    });
    metadataData.push(metadataHeaders);

    // Trial metadata categories
    trialMetadataCategories.forEach((category) => {
      const totalStudies = Object.values(productGroups).reduce((acc, group) => acc + group.studies.length, 0);
      metadataData.push([`📋 ${category.name.toUpperCase()}`, '', ...new Array(totalStudies).fill('')]);
      
      category.subcategories.forEach((subcategory) => {
        const row = ['', subcategory.name];
        
        Object.entries(productGroups).forEach(([productKey, group]) => {
          group.studies.forEach((study) => {
            const data = study.trialMetadataSummary?.[subcategory.id];
            let displayData = data || 'Not specified';
            
            if (typeof displayData === 'string') {
              displayData = displayData.replace(/<[^>]*>/g, '').replace(/\n/g, ' ').trim();
              if (displayData.length > 400) {
                displayData = displayData.substring(0, 397) + '...';
              }
            }
            
            row.push(displayData);
          });
        });
        
        metadataData.push(row);
      });
      metadataData.push([]);
    });
    
    // Reference Files Section (same as clinical data)
    metadataData.push(['📁 REFERENCE FILES BY STUDY']);
    metadataData.push([]);
    
    Object.entries(productGroups).forEach(([productKey, group]) => {
      const drugName = group.productInfo?.DrugName || 'Unknown Drug';
      metadataData.push([`PRODUCT: ${drugName}`]);
      
      group.studies.forEach((study, studyIndex) => {
        const sourceFiles = getSourceFilesForStudy(study);
        metadataData.push([`  📄 ${study.studyType}:`, sourceFiles.join('; ')]);
      });
      metadataData.push([]);
    });

    const metadataWorksheet = XLSX.utils.aoa_to_sheet(metadataData);
    
    // Enhanced column widths
    const metadataColWidths = [{ wch: 30 }, { wch: 40 }];
    Object.entries(productGroups).forEach(([productKey, group]) => {
      group.studies.forEach(() => {
        metadataColWidths.push({ wch: 50 });
      });
    });
    metadataWorksheet['!cols'] = metadataColWidths;
    
    // Enhanced formatting (same as clinical)
    const metadataRange = XLSX.utils.decode_range(metadataWorksheet['!ref']);
    for (let row = metadataRange.s.r; row <= metadataRange.e.r; row++) {
      for (let col = metadataRange.s.c; col <= metadataRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!metadataWorksheet[cellAddress]) continue;
        
        const cellValue = metadataWorksheet[cellAddress].v;
        if (cellValue && typeof cellValue === 'string') {
          if (cellValue.includes('🔬') || cellValue.includes('📋') || cellValue.includes('📊') || cellValue.includes('📁')) {
            metadataWorksheet[cellAddress].s = {
              font: { bold: true, size: 14, color: { rgb: "0969DA" } },
              fill: { fgColor: { rgb: "F0F8FF" } }
            };
          }
          else if (cellValue.startsWith('PRODUCT ') && cellValue.includes(':')) {
            metadataWorksheet[cellAddress].s = {
              font: { bold: true, size: 12, color: { rgb: "6F42C1" } },
              fill: { fgColor: { rgb: "F3E8FF" } }
            };
          }
          else if (cellValue.startsWith('📋 ') && col === 0) {
            metadataWorksheet[cellAddress].s = {
              font: { bold: true, size: 11 },
              fill: { fgColor: { rgb: "E9ECEF" } }
            };
          }
        }
      }
    }

    XLSX.utils.book_append_sheet(workbook, metadataWorksheet, 'Trial Metadata');

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    const filename = `Clinical_Summary_Intelligent_Export_${timestamp}.xlsx`;

    // Save the file
    XLSX.writeFile(workbook, filename);
  };

  if (!summaries || summaries.length === 0) {
    return <div className="summary-table-empty">No summaries selected for comparison</div>;
  }

  const productOverviewKeys = ['DrugName', 'MechanismOfAction', 'RouteOfAdministration', 'Company'];

  // Render trial metadata table for page 2
  const renderTrialMetadataTable = () => (
    <div className="summary-table-scroll-container">
      <table className="summary-table">
        <colgroup>
          <col style={{ width: '220px' }} />
          <col style={{ width: '300px' }} />
          {groupedSummaries.map(group => (
            group.studies.map((study, index) => (
              <col key={`${group.key}_studycol_${index}`} style={{minWidth: '250px'}} />
            ))
          ))}
        </colgroup>
        
        <thead>
          <tr>
            <th className="category-cell">Study</th>
            <th className="subcategory-cell">Trial Metadata</th>
            {groupedSummaries.map(group => (
              group.studies.map((study, studyIndex) => {
                const studyKey = `${group.key}_${studyIndex}`;
                const studyType = study.StudyDetails?.StudyType || 'Unknown Study';
                
                return (
                  <th key={studyKey} className="study-header">
                    <div className="study-info">
                      <div className="study-title">{group.drugName} - {studyType}</div>
                    </div>
                  </th>
                );
              })
            ))}
          </tr>
        </thead>

        <tbody>
          {trialMetadataCategories.map((category) => (
            <React.Fragment key={category.id}>
              {category.subcategories.map((subcategory, subIndex) => (
                <tr key={category.id + subcategory.id}>
                  {subIndex === 0 && (
                    <td rowSpan={category.subcategories.length} className="category-cell">
                      {category.name}
                    </td>
                  )}
                  <td className="subcategory-cell">{subcategory.name}</td>
                  {groupedSummaries.map(group => (
                    group.studies.map((study, studyIndex) => {
                      const studyKey = `${group.key}_${studyIndex}`;                      const data = study.trialMetadataSummary?.[subcategory.id];
                      let displayData = data || 'Not specified';
                      
                      const referenceInfo = getFieldReferenceInfo(study, category.id, subcategory.id);
                      
                      return (
                        <td 
                          key={`${group.key}_${studyIndex}_${category.id}_${subcategory.id}`}
                        >
                          <div className="cell-content">
                            <span className="cell-data">{displayData}</span>
                            <ReferenceIndicator 
                              count={referenceInfo.count} 
                              hasMultipleFiles={referenceInfo.hasMultipleFiles} 
                              onClick={() => {
                                if (referenceInfo.count > 0) {
                                  handleShowReferencePopup(category, subcategory, study);
                                }
                              }}
                            />
                          </div>
                        </td>
                      );
                    })
                  ))}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="summary-table-container">      {/* Pagination Controls */}
      <div className="pagination-controls">
        <button 
          className={`page-btn ${currentPage === 1 ? 'active' : ''}`}
          onClick={() => setCurrentPage(1)}
        >
          Page 1: Clinical Data
        </button>
        <button 
          className={`page-btn ${currentPage === 2 ? 'active' : ''}`}
          onClick={() => setCurrentPage(2)}
        >
          Page 2: Trial Metadata
        </button>
        <button 
          className="export-btn"
          onClick={exportToExcel}
          title="Export both pages to Excel"
        >
          📊 Export to Excel
        </button>
      </div>

      {/* Page 1: Clinical Data */}
      {currentPage === 1 && (
        <div className="summary-table-scroll-container">
          <table className="summary-table">
            <colgroup>
              <col style={{ width: '220px' }} />
              <col style={{ width: '300px' }} />
              {groupedSummaries.map(group => (
                group.studies.map((study, index) => (
                  <col key={`${group.key}_studycol_${index}`} style={{minWidth: '250px'}} />
                ))
              ))}
            </colgroup>
            
            <thead>
              {/* Study headers with file names */}
              <tr>
                <th className="category-cell">Study</th>
                <th className="subcategory-cell">Files</th>
                {groupedSummaries.map(group => (
                  group.studies.map((study, studyIndex) => {
                    const studyKey = `${group.key}_${studyIndex}`;
                    const studyType = study.StudyDetails?.StudyType || 'Unknown Study';
                    const sourceFiles = getSourceFilesForStudy(study);
                    
                    return (
                      <th key={studyKey} className="study-header">
                        <div className="study-info">
                          <div className="study-title">{group.drugName} - {studyType}</div>
                          <div className="source-files">
                            {sourceFiles.map(fileName => (
                              <span
                                key={fileName}
                                className={`file-name ${highlightedFileInfo?.fileName === fileName && highlightedFileInfo?.studyKey === studyKey ? 'highlighted' : ''}`}
                                onClick={() => handleFileClick(fileName, studyKey)}
                                title={`Click to highlight fields from ${fileName}`}
                              >
                                {fileName}
                              </span>
                            ))}
                          </div>
                        </div>
                      </th>
                    );
                  })
                ))}
              </tr>

              {/* Product Overview rows */}
              {productOverviewKeys.map(detailKey => {
                const detailLabel = DRUG_SUBCATEGORIES[detailKey] || detailKey.replace(/([A-Z])/g, ' $1').trim();
                return (
                  <tr key={detailKey + '_row'}>
                    <th className="category-cell product-overview-label">{detailLabel}</th>
                    <td className="subcategory-cell product-overview-empty"></td>
                    {groupedSummaries.map(group => {
                      const groupValue = group.studies[0]?.ProductOverview?.[detailKey];
                      return (
                        <td 
                          key={`${group.key}_${detailKey}`}
                          colSpan={group.studies.length} 
                          className="product-overview-value"
                        >
                          {groupValue || 'Not specified'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </thead>

            <tbody>
              {categories.map((category) => (
                <React.Fragment key={category.id}>
                  {category.subcategories.map((subcategory, subIndex) => (
                    <tr key={category.id + subcategory.id}>
                      {subIndex === 0 && (
                        <td rowSpan={category.subcategories.length} className="category-cell">
                          {category.name}
                        </td>
                      )}
                      <td className="subcategory-cell">{subcategory.name}</td>
                      {groupedSummaries.map(group => (
                        group.studies.map((study, studyIndex) => {
                          const studyKey = `${group.key}_${studyIndex}`;
                          const data = study[category.id]?.[subcategory.id];
                          let displayData = data || 'Not specified';
                          
                          if (subcategory.id === 'ClinicalTrialRegistryNumber' || subcategory.id === 'LongTermClinicalTrialRegistryNumber') {
                            displayData = renderAsPlainText(data);
                          } else if (subcategory.id === 'Dose') { 
                            displayData = formatDose(data);
                          }

                          let cellClassName = '';
                          if(category.id === 'EfficacyEndpoints'){
                            if(subcategory.id === 'PrimaryEndpoints') cellClassName = 'primary-endpoint';
                            else if(subcategory.id === 'SecondaryEndpoints') cellClassName = 'secondary-endpoint';
                            else if(subcategory.id === 'ExploratoryEndpoints') cellClassName = 'exploratory-endpoint';
                          }
                          
                          const isHighlighted = data && data !== 'Not specified' && shouldHighlightCell(category, subcategory, study, studyKey);
                          if (isHighlighted) {
                            cellClassName += cellClassName ? ' highlighted-from-file' : 'highlighted-from-file';
                          }
                          
                          const referenceInfo = getFieldReferenceInfo(study, category.id, subcategory.id);
                          
                          return (
                            <td 
                              key={`${group.key}_${studyIndex}_${category.id}_${subcategory.id}`} 
                              className={cellClassName}
                            >
                              <div className="cell-content">
                                <span className="cell-data">{displayData}</span>
                                <ReferenceIndicator 
                                  count={referenceInfo.count} 
                                  hasMultipleFiles={referenceInfo.hasMultipleFiles} 
                                  onClick={() => {
                                    if (referenceInfo.count > 0) {
                                      handleShowReferencePopup(category, subcategory, study);
                                    }
                                  }}
                                />
                              </div>
                            </td>
                          );
                        })
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Page 2: Trial Metadata */}
      {currentPage === 2 && renderTrialMetadataTable()}

      {/* Reference Popup */}
      {referencePopupData && (
        <ReferencePopup
          fieldInfo={referencePopupData.fieldInfo}
          references={referencePopupData.references}
          onClose={() => setReferencePopupData(null)}
          onOpenPDF={handleOpenPDFFromPopup}
        />
      )}
      
      {/* PDF Viewer */}
      {pdfViewerState && (
        <PDFHighlighter 
          pdfUrl={pdfViewerState.pdfUrl} 
          pageNumber={pdfViewerState.pageNumber} 
          bboxHighlights={pdfViewerState.bboxHighlights}
          citationPageNumbers={pdfViewerState.citationPageNumbers}
          onClose={() => setPdfViewerState(null)}
        />
      )}
    </div>
  );
};

export default SummaryTableView;
