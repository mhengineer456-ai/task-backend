import express from 'express';
import {
  getChannels,
  getMessagesByChannel,
  sendMessage,
  deleteMessage,
  clearChannelMessages,
  deleteChannel,
  createOrGetDirectChannel,
  createGroupChannel,
  toggleReaction,
  askAiAssistant,
  getAiStatus,
  generateLotPdf,
  generatePartyPdf,
  generateAccessoryStockPdfController,
  generateCutLotsBarcodePdfController,
  generateUncutLotsPdfController,
  proxyImage,
  getAiContextForN8n,
  delegateAiTask,
  getAccessoryStatus,
  getAccessoryLotReport,
  getAccessoryWeightCaptures,
  getAccessoryIssueLogs,
  getAccessoryMaterials,
  getAccessoryOverview,
  getAccessoryTransfers,
  getAccessoryRgps,
  getAccessoryScansController
} from '../controllers/chatController.js';

const router = express.Router();

router.get('/channels', getChannels);
router.get('/messages/:channelId', getMessagesByChannel);
router.get('/channels/:channelId/messages', getMessagesByChannel);
router.post('/messages', sendMessage);
router.delete('/messages/:messageId', deleteMessage);
router.delete('/channels/:channelId/messages', clearChannelMessages);
router.post('/channels/:channelId/clear', clearChannelMessages);
router.delete('/channels/:channelId', deleteChannel);
router.post('/messages/:messageId/reaction', toggleReaction);
router.post('/direct-channel', createOrGetDirectChannel);
router.post('/groups', createGroupChannel);

// PDF Generator Routes for Chatbot
router.get('/pdf/cut-lots-barcode-pending', generateCutLotsBarcodePdfController);
router.get('/pdf/uncut-lots-pending', generateUncutLotsPdfController);
router.get('/pdf/accessory-stock', generateAccessoryStockPdfController);
router.post('/pdf/accessory-stock', generateAccessoryStockPdfController);
router.get('/pdf/party/:partyName', generatePartyPdf);
router.get('/pdf/:lotNumber', generateLotPdf);

// Direct Image Proxy Route for Google Drive and Artwork Images
router.get('/image-proxy', proxyImage);

// High-Speed AI Aggregated Context for n8n Workflow (Solution 1: < 5ms local cache)
router.post('/ai-context', getAiContextForN8n);
router.get('/ai-context', getAiContextForN8n);

// Secondary Accessory Software SQL Database Integration Routes
router.get('/accessory-status', getAccessoryStatus);
router.get('/accessory/status', getAccessoryStatus);
router.get('/accessory/overview', getAccessoryOverview);
router.get('/accessory/lot/:lotNo', getAccessoryLotReport);
router.get('/accessory/weight-capture', getAccessoryWeightCaptures);
router.get('/accessory/issue-logs', getAccessoryIssueLogs);
router.get('/accessory/materials', getAccessoryMaterials);
router.get('/accessory/transfers', getAccessoryTransfers);
router.get('/accessory/rgp', getAccessoryRgps);
router.get('/accessory/scans', getAccessoryScansController);

// n8n AI Assistant Integration
router.post('/ai-assistant', askAiAssistant);
router.post('/delegate-task', delegateAiTask);
router.get('/status', getAiStatus);

export default router;


