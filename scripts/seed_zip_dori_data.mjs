import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.join(__dirname, '../data/sheetsData.json');
const raw = fs.readFileSync(dataPath, 'utf8');
const data = JSON.parse(raw);

if (!data.customSheets) {
  data.customSheets = {};
}

// 1. Seed ZipPurchaseOrders from Google Sheet "ZIP/DORI MANAGEMENT AND ORDER"
const zipRows = [
  { row_number: 2, "Timestamp": "11/3/2025", "Lot Number": "11142", "PDF Generated Date": "11/3/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/5/2025", "Material Received By": "Monu", "Material Received Date": "11/5/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/5/2025", "Approval ID": "APPROVAL_1762513976144_eyhbcsrm" },
  { row_number: 3, "Timestamp": "11/5/2025", "Lot Number": "11025", "PDF Generated Date": "11/5/2025", "Gate Entry Person": "", "Gate Entry Date": "", "Material Received By": "Sanjay", "Material Received Date": "11/5/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/5/2025", "Approval ID": "" },
  { row_number: 4, "Timestamp": "11/5/2025", "Lot Number": "11163", "PDF Generated Date": "11/5/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/10/2025", "Material Received By": "Monu", "Material Received Date": "11/10/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/10/2025", "Approval ID": "" },
  { row_number: 5, "Timestamp": "11/5/2025", "Lot Number": "11162", "PDF Generated Date": "11/5/2025", "Gate Entry Person": "Kewal krishan", "Gate Entry Date": "11/20/2025", "Material Received By": "Monu Stitching", "Material Received Date": "11/20/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/20/2025", "Approval ID": "" },
  { row_number: 6, "Timestamp": "11/6/2025", "Lot Number": "61003", "PDF Generated Date": "11/6/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/10/2025", "Material Received By": "Sanjay kumar", "Material Received Date": "11/10/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/10/2025", "Approval ID": "APPROVAL_1762430756716_ukqrol2gc" },
  { row_number: 7, "Timestamp": "11/6/2025", "Lot Number": "11125", "PDF Generated Date": "11/6/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/8/2025", "Material Received By": "Rahul kumar (Rohit thekedar)", "Material Received Date": "11/8/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/8/2025", "Approval ID": "APPROVAL_1762430942236_qlqav4p2o" },
  { row_number: 8, "Timestamp": "11/6/2025", "Lot Number": "11131", "PDF Generated Date": "11/6/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/10/2025", "Material Received By": "Rahul kumar", "Material Received Date": "11/10/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/10/2025", "Approval ID": "APPROVAL_1762431027954_t8mjwf5aj" },
  { row_number: 9, "Timestamp": "11/7/2025", "Lot Number": "11129", "PDF Generated Date": "11/7/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/13/2025", "Material Received By": "Monu Stitching", "Material Received Date": "11/13/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/13/2025", "Approval ID": "" },
  { row_number: 10, "Timestamp": "11/7/2025", "Lot Number": "11165", "PDF Generated Date": "11/7/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/11/2025", "Material Received By": "Monu Stitching", "Material Received Date": "11/11/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/11/2025", "Approval ID": "" },
  { row_number: 11, "Timestamp": "11/7/2025", "Lot Number": "11164", "PDF Generated Date": "11/7/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/13/2025", "Material Received By": "Sonu", "Material Received Date": "11/13/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/13/2025", "Approval ID": "" },
  { row_number: 12, "Timestamp": "11/7/2025", "Lot Number": "11117", "PDF Generated Date": "11/7/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/12/2025", "Material Received By": "Sanjaykumar", "Material Received Date": "11/12/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/12/2025", "Approval ID": "" },
  { row_number: 13, "Timestamp": "11/7/2025", "Lot Number": "73035", "PDF Generated Date": "11/7/2025", "Gate Entry Person": "Surinder", "Gate Entry Date": "12/2/2025", "Material Received By": "Sheela guru", "Material Received Date": "12/2/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/20/2025", "Approval ID": "" },
  { row_number: 14, "Timestamp": "11/7/2025", "Lot Number": "73036", "PDF Generated Date": "11/7/2025", "Gate Entry Person": "Surinder", "Gate Entry Date": "12/2/2025", "Material Received By": "Sheela guru", "Material Received Date": "12/2/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/20/2025", "Approval ID": "" },
  { row_number: 15, "Timestamp": "11/7/2025", "Lot Number": "11127", "PDF Generated Date": "11/7/2025", "Gate Entry Person": "Surender", "Gate Entry Date": "11/8/2025", "Material Received By": "Sanjaykumar", "Material Received Date": "11/8/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/8/2025", "Approval ID": "" },
  { row_number: 16, "Timestamp": "11/7/2025", "Lot Number": "11095", "PDF Generated Date": "11/7/2025", "Gate Entry Person": "", "Gate Entry Date": "", "Material Received By": "", "Material Received Date": "", "Supplier Name": "Puneet zip", "Material Entry Date": "11/20/2025", "Approval ID": "" },
  { row_number: 17, "Timestamp": "11/10/2025", "Lot Number": "11173", "PDF Generated Date": "11/10/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/13/2025", "Material Received By": "Sanjaykumar", "Material Received Date": "11/13/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/13/2025", "Approval ID": "" },
  { row_number: 18, "Timestamp": "11/10/2025", "Lot Number": "11161", "PDF Generated Date": "11/10/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/11/2025", "Material Received By": "Monu Stitching", "Material Received Date": "11/11/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/11/2025", "Approval ID": "" },
  { row_number: 19, "Timestamp": "11/10/2025", "Lot Number": "11172", "PDF Generated Date": "11/10/2025", "Gate Entry Person": "Kewalkrishan", "Gate Entry Date": "11/14/2025", "Material Received By": "Monu Stitching", "Material Received Date": "11/14/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/14/2025", "Approval ID": "" },
  { row_number: 20, "Timestamp": "11/10/2025", "Lot Number": "11104", "PDF Generated Date": "11/10/2025", "Gate Entry Person": "Kewal krishan", "Gate Entry Date": "11/14/2025", "Material Received By": "Rahul kumar", "Material Received Date": "11/14/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/14/2025", "Approval ID": "" },
  { row_number: 21, "Timestamp": "11/10/2025", "Lot Number": "11123", "PDF Generated Date": "11/10/2025", "Gate Entry Person": "Kewal krishan", "Gate Entry Date": "11/14/2025", "Material Received By": "Rahul kumar", "Material Received Date": "11/14/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/14/2025", "Approval ID": "" },
  { row_number: 22, "Timestamp": "11/12/2025", "Lot Number": "11196", "PDF Generated Date": "11/12/2025", "Gate Entry Person": "Kewal Krishan", "Gate Entry Date": "11/17/2025", "Material Received By": "Rohit", "Material Received Date": "11/17/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/17/2025", "Approval ID": "" },
  { row_number: 23, "Timestamp": "11/12/2025", "Lot Number": "11197", "PDF Generated Date": "11/12/2025", "Gate Entry Person": "Kewal Krishan", "Gate Entry Date": "11/17/2025", "Material Received By": "Monu Stitching", "Material Received Date": "11/17/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/17/2025", "Approval ID": "" },
  { row_number: 24, "Timestamp": "11/12/2025", "Lot Number": "11162", "PDF Generated Date": "11/12/2025", "Gate Entry Person": "Kewal krishan", "Gate Entry Date": "11/20/2025", "Material Received By": "Monu Stitching", "Material Received Date": "11/20/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/12/2025", "Approval ID": "" },
  { row_number: 25, "Timestamp": "11/12/2025", "Lot Number": "11195", "PDF Generated Date": "11/12/2025", "Gate Entry Person": "Kewal krishan", "Gate Entry Date": "11/20/2025", "Material Received By": "Enjmam", "Material Received Date": "11/20/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/20/2025", "Approval ID": "" },
  { row_number: 26, "Timestamp": "11/12/2025", "Lot Number": "73035", "PDF Generated Date": "11/12/2025", "Gate Entry Person": "Surender", "Gate Entry Date": "11/20/2025", "Material Received By": "Aslam", "Material Received Date": "11/20/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/20/2025", "Approval ID": "" },
  { row_number: 27, "Timestamp": "11/12/2025", "Lot Number": "73036", "PDF Generated Date": "11/12/2025", "Gate Entry Person": "Surender", "Gate Entry Date": "11/20/2025", "Material Received By": "Aslam", "Material Received Date": "11/20/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/20/2025", "Approval ID": "" },
  { row_number: 28, "Timestamp": "11/12/2025", "Lot Number": "73046", "PDF Generated Date": "11/12/2025", "Gate Entry Person": "Surinder", "Gate Entry Date": "11/22/2025", "Material Received By": "", "Material Received Date": "", "Supplier Name": "Puneet zip", "Material Entry Date": "11/22/2025", "Approval ID": "" },
  { row_number: 29, "Timestamp": "11/12/2025", "Lot Number": "11179", "PDF Generated Date": "11/12/2025", "Gate Entry Person": "Kewal krishan", "Gate Entry Date": "11/25/2025", "Material Received By": "", "Material Received Date": "", "Supplier Name": "Puneet zip", "Material Entry Date": "11/23/2025", "Approval ID": "" },
  { row_number: 30, "Timestamp": "11/12/2025", "Lot Number": "11166", "PDF Generated Date": "11/12/2025", "Gate Entry Person": "Kewal krishan", "Gate Entry Date": "11/21/2025", "Material Received By": "Narender", "Material Received Date": "11/21/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/21/2025", "Approval ID": "" },
  { row_number: 31, "Timestamp": "11/13/2025", "Lot Number": "11185", "PDF Generated Date": "11/13/2025", "Gate Entry Person": "Kewal krishan", "Gate Entry Date": "11/17/2025", "Material Received By": "Monu Stitching", "Material Received Date": "11/17/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/17/2025", "Approval ID": "" },
  { row_number: 32, "Timestamp": "11/13/2025", "Lot Number": "11128", "PDF Generated Date": "11/13/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/19/2025", "Material Received By": "Monu Stitching", "Material Received Date": "11/19/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/19/2025", "Approval ID": "" },
  { row_number: 33, "Timestamp": "11/13/2025", "Lot Number": "11080", "PDF Generated Date": "11/13/2025", "Gate Entry Person": "Kewal Krishan", "Gate Entry Date": "11/17/2025", "Material Received By": "Monu Stitching", "Material Received Date": "11/17/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/17/2025", "Approval ID": "" },
  { row_number: 34, "Timestamp": "11/15/2025", "Lot Number": "11137", "PDF Generated Date": "11/15/2025", "Gate Entry Person": "Abhishek", "Gate Entry Date": "11/19/2025", "Material Received By": "Monu Stitching", "Material Received Date": "11/19/2025", "Supplier Name": "Puneet zip", "Material Entry Date": "11/19/2025", "Approval ID": "" }
];

data.customSheets["zip_purchase_orders"] = {
  meta: {
    id: "zip_purchase_orders",
    spreadsheetId: "16miFNw0WMllnZ1XRHtsuH_8kVUM_6Y1O3uVsoM-Hjppo",
    tabName: "ZipPurchaseOrders",
    displayName: "Zip Purchase Orders & Gate Entry",
    category: "Materials",
    keyColumn: "Lot Number"
  },
  headers: ["Timestamp", "Lot Number", "PDF Generated Date", "Gate Entry Person", "Gate Entry Date", "Material Received By", "Material Received Date", "Supplier Name", "Material Entry Date", "Approval ID"],
  rows: zipRows,
  count: zipRows.length
};

// 2. Seed DoriPurchaseOrders from Google Sheet "DORI PURCHASE ORDER"
const doriRows = [
  { row_number: 2, "Timestamp": "11/25/2025", "Lot Number": "11202", "Garment Type": "NIKKER", "Style": "CARGO NIKKER", "Fabric": "JORDAN RIB", "Total Pieces": "300", "Issue Date": "2025-11-25", "Supervisor": "Monu", "Dori Selections": "{\"EL\":\"Coloured\",\"NAVY\":\"Coloured\"}" },
  { row_number: 3, "Timestamp": "11/25/2025", "Lot Number": "11201", "Garment Type": "NIKKER", "Style": "CARGO NIKKER", "Fabric": "JORDAN RIB", "Total Pieces": "720", "Issue Date": "2025-11-25", "Supervisor": "Monu", "Dori Selections": "{\"BLACK\":\"Black\",\"FAWN\":\"Coloured\"}" },
  { row_number: 4, "Timestamp": "11/26/2025", "Lot Number": "61008", "Garment Type": "LOWER", "Style": "LOWER CARGO", "Fabric": "Q20", "Total Pieces": "342", "Issue Date": "2025-11-28", "Supervisor": "Monu", "Dori Selections": "{\"OFFEE\":\"Coloured\",\"D OLIVE\":\"Coloured\"}" },
  { row_number: 5, "Timestamp": "11/28/2025", "Lot Number": "11196", "Garment Type": "LOWER", "Style": "17-18 MOHRI", "Fabric": "MICKEY", "Total Pieces": "695", "Issue Date": "2025-11-28", "Supervisor": "Rohit", "Dori Selections": "{\"GREY\":\"Coloured\",\"NAVY\":\"Coloured\"}" },
  { row_number: 6, "Timestamp": "12/1/2025", "Lot Number": "11203", "Garment Type": "LOWER", "Style": "LOWER", "Fabric": "HARISH PRINT CAMO", "Total Pieces": "920", "Issue Date": "2025-12-01", "Supervisor": "Monu", "Dori Selections": "{\"GREY\":\"Coloured\",\"MILITARY\":\"Coloured\"}" },
  { row_number: 7, "Timestamp": "12/1/2025", "Lot Number": "11204", "Garment Type": "LOWER", "Style": "LOWER", "Fabric": "U K LYCRA", "Total Pieces": "1100", "Issue Date": "2025-12-01", "Supervisor": "Sanjay", "Dori Selections": "{\"MOUSE (3D SET)\":\"Coloured\",\"OFF WHITE\":\"Coloured\"}" },
  { row_number: 8, "Timestamp": "12/2/2025", "Lot Number": "11239", "Garment Type": "NIKKER", "Style": "NIKKAR", "Fabric": "U K LYCRA", "Total Pieces": "920", "Issue Date": "2025-12-02", "Supervisor": "Monu", "Dori Selections": "{\"RED\":\"Coloured\",\"ROYAL\":\"Coloured\"}" },
  { row_number: 9, "Timestamp": "12/2/2025", "Lot Number": "11127", "Garment Type": "LOWER", "Style": "", "Fabric": "SKD", "Total Pieces": "300", "Issue Date": "2025-12-02", "Supervisor": "Sanjay", "Dori Selections": "{\"BLACK\":\"Black\",\"BROWN\":\"Coloured\"}" },
  { row_number: 10, "Timestamp": "12/6/2025", "Lot Number": "11264", "Garment Type": "LOWER", "Style": "LOWER", "Fabric": "U.K LYCRA", "Total Pieces": "625", "Issue Date": "2025-12-06", "Supervisor": "Rohit", "Dori Selections": "{\"BLACK\":\"Black\",\"NAVY\":\"Coloured\"}" },
  { row_number: 11, "Timestamp": "12/8/2025", "Lot Number": "11194", "Garment Type": "TRACK SUIT", "Style": "CROSS HODDIE", "Fabric": "GERMAN FLEECE", "Total Pieces": "200", "Issue Date": "2025-12-08", "Supervisor": "Rohit", "Dori Selections": "{\"15%\":\"Coloured\",\"BLACK\":\"Black\"}" },
  { row_number: 12, "Timestamp": "12/8/2025", "Lot Number": "11063", "Garment Type": "TRACK SUIT", "Style": "JOGGER", "Fabric": "GERMAN FLEECE", "Total Pieces": "840", "Issue Date": "2025-12-08", "Supervisor": "Rohit", "Dori Selections": "{\"Coloured\":\"BEIGE\",\"BLACK\":\"Black\"}" },
  { row_number: 13, "Timestamp": "12/8/2025", "Lot Number": "61015", "Garment Type": "LOWER", "Style": "", "Fabric": "U K LYCRA", "Total Pieces": "1020", "Issue Date": "2025-12-08", "Supervisor": "Sanjay", "Dori Selections": "{\"Coloured\":\"RED (HALF)\",\"BLACK\":\"Black\"}" },
  { row_number: 14, "Timestamp": "12/8/2025", "Lot Number": "61010", "Garment Type": "LOWER", "Style": "LOWER", "Fabric": "H N M LYCRA", "Total Pieces": "528", "Issue Date": "2025-12-08", "Supervisor": "Sanjay", "Dori Selections": "{\"COFFEE\":\"Coloured\",\"CREAM\":\"Coloured\"}" },
  { row_number: 15, "Timestamp": "12/8/2025", "Lot Number": "11192", "Garment Type": "TRACK SUIT", "Style": "T/NECK FULL ZIPPER", "Fabric": "GERMAN FLEECE", "Total Pieces": "300", "Issue Date": "2025-12-08", "Supervisor": "Rohit", "Dori Selections": "{\"15%\":\"Coloured\",\"BLACK\":\"Black\",\"RED\":\"Coloured\"}" },
  { row_number: 16, "Timestamp": "12/8/2025", "Lot Number": "61016", "Garment Type": "LOWER", "Style": "LOWER", "Fabric": "U K LYCRA", "Total Pieces": "978", "Issue Date": "2025-12-08", "Supervisor": "Sheelaguru", "Dori Selections": "{\"Coloured\":\"RED (HALF)\",\"BLACK\":\"Black\"}" },
  { row_number: 17, "Timestamp": "12/9/2025", "Lot Number": "11199", "Garment Type": "NIKKER", "Style": "LOWER CARGO", "Fabric": "U K LYCRA", "Total Pieces": "1072", "Issue Date": "2025-12-09", "Supervisor": "Monu", "Dori Selections": "{\"GREEN\":\"Coloured\",\"ORANGE (WHITE)\":\"Coloured\"}" },
  { row_number: 18, "Timestamp": "12/9/2025", "Lot Number": "11281", "Garment Type": "LOWER", "Style": "LOWER", "Fabric": "U.K LYCRA", "Total Pieces": "1170", "Issue Date": "2025-12-09", "Supervisor": "Sheelaguru", "Dori Selections": "{\"D GREY (25)\":\"Coloured\",\"LEMON(1)\":\"Coloured\"}" },
  { row_number: 19, "Timestamp": "12/10/2025", "Lot Number": "11233", "Garment Type": "JOGGER", "Style": "jogger", "Fabric": "GERMAN FLEECE", "Total Pieces": "960", "Issue Date": "2025-12-10", "Supervisor": "Rohit", "Dori Selections": "{\"D GREY\":\"Coloured\",\"CAMEL\":\"Coloured\"}" },
  { row_number: 20, "Timestamp": "12/10/2025", "Lot Number": "11232", "Garment Type": "JOGGER", "Style": "jogger", "Fabric": "GERMAN FLEECE", "Total Pieces": "985", "Issue Date": "2025-12-10", "Supervisor": "Rohit", "Dori Selections": "{\"Coloured\":\"BEIGE\",\"BLACK\":\"Black\"}" },
  { row_number: 21, "Timestamp": "12/10/2025", "Lot Number": "11123", "Garment Type": "TRACK SUIT", "Style": "COLLAR + THOKA", "Fabric": "GERMAN FLEECE", "Total Pieces": "525", "Issue Date": "2025-12-10", "Supervisor": "Rohit", "Dori Selections": "{\"BLACK\":\"Black\",\"DARK GREY\":\"Coloured\"}" },
  { row_number: 22, "Timestamp": "12/10/2025", "Lot Number": "11263", "Garment Type": "LOWER", "Style": "LOWER", "Fabric": "U K LYCRA", "Total Pieces": "620", "Issue Date": "2025-12-10", "Supervisor": "Sanjay", "Dori Selections": "{\"WHITE (D GREY 25)\":\"Coloured\",\"OLIVE (D GREY 25)\":\"Coloured\"}" },
  { row_number: 23, "Timestamp": "12/11/2025", "Lot Number": "11234", "Garment Type": "JOGGER", "Style": "jogger", "Fabric": "GERMAN FLEECE", "Total Pieces": "850", "Issue Date": "2025-12-11", "Supervisor": "Rohit", "Dori Selections": "{\"Red\":\"BEIGE\",\"BLACK\":\"Black\"}" },
  { row_number: 24, "Timestamp": "12/11/2025", "Lot Number": "11200", "Garment Type": "NIKKER", "Style": "CARGO NIKKER", "Fabric": "CAMO D123", "Total Pieces": "600", "Issue Date": "2025-12-11", "Supervisor": "Monu", "Dori Selections": "{\"Coloured\":\"GREY\",\"IVORY\":\"Coloured\"}" },
  { row_number: 25, "Timestamp": "12/11/2025", "Lot Number": "11212", "Garment Type": "LOWER", "Style": "LOWER CARGO", "Fabric": "GERMAN FLEECE", "Total Pieces": "263", "Issue Date": "2025-12-11", "Supervisor": "Rohit", "Dori Selections": "{\"15% (20)\":\"Coloured\",\"BLACK (30)\":\"Black\"}" },
  { row_number: 26, "Timestamp": "12/11/2025", "Lot Number": "11213", "Garment Type": "LOWER", "Style": "LOWER CARGO", "Fabric": "GERMAN FLEECE", "Total Pieces": "270", "Issue Date": "2025-12-11", "Supervisor": "Rohit", "Dori Selections": "{\"15% (20)\":\"Coloured\",\"BLACK (30)\":\"Black\"}" },
  { row_number: 27, "Timestamp": "12/11/2025", "Lot Number": "11244", "Garment Type": "LOWER", "Style": "LOWER CARGO", "Fabric": "GERMAN FLEECE", "Total Pieces": "264", "Issue Date": "2025-12-11", "Supervisor": "Rohit", "Dori Selections": "{\"15% (20)\":\"Coloured\",\"BLACK (30)\":\"Black\"}" },
  { row_number: 28, "Timestamp": "12/11/2025", "Lot Number": "11189", "Garment Type": "TRACK SUIT", "Style": "T/NECK FULL ZIPPER", "Fabric": "GERMAN FLEECE", "Total Pieces": "200", "Issue Date": "2025-12-11", "Supervisor": "Sanjay", "Dori Selections": "{\"15%\":\"Coloured\",\"BLACK\":\"Black\"}" },
  { row_number: 29, "Timestamp": "12/11/2025", "Lot Number": "11165", "Garment Type": "TRACK SUIT", "Style": "LOWER", "Fabric": "GERMAN FLEECE", "Total Pieces": "600", "Issue Date": "2025-12-11", "Supervisor": "Monu", "Dori Selections": "{\"15%\":\"Coloured\",\"BLACK\":\"Black\"}" },
  { row_number: 30, "Timestamp": "12/11/2025", "Lot Number": "11128", "Garment Type": "LOWER", "Style": "", "Fabric": "WONDER CHECK", "Total Pieces": "405", "Issue Date": "2025-12-11", "Supervisor": "Monu", "Dori Selections": "{\"Coloured\":\"FAWN\",\"GREEN\":\"Coloured\"}" },
  { row_number: 31, "Timestamp": "12/12/2025", "Lot Number": "11300", "Garment Type": "LOWER", "Style": "LOWER", "Fabric": "TWILL TERRY", "Total Pieces": "350", "Issue Date": "2025-12-12", "Supervisor": "Sheelaguru", "Dori Selections": "{\"D GREY (20)\":\"Coloured\",\"L GREY (10)\":\"Coloured\"}" },
  { row_number: 32, "Timestamp": "12/12/2025", "Lot Number": "11299", "Garment Type": "LOWER", "Style": "LOWER", "Fabric": "CEMO D2", "Total Pieces": "600", "Issue Date": "2025-12-12", "Supervisor": "Sheelaguru", "Dori Selections": "{\"Coloured\":\"IVORY\",\"MILTARY\":\"Coloured\"}" },
  { row_number: 33, "Timestamp": "12/13/2025", "Lot Number": "11301", "Garment Type": "LOWER", "Style": "LOWER", "Fabric": "TWILL TERRY", "Total Pieces": "350", "Issue Date": "2025-12-13", "Supervisor": "Sheelaguru", "Dori Selections": "{\"BLACK (20)\":\"Black\",\"L BROWN (10)\":\"Coloured\"}" },
  { row_number: 34, "Timestamp": "12/15/2025", "Lot Number": "62002", "Garment Type": "LOWER", "Style": "boot cut without zip", "Fabric": "GERMAN FLEECE", "Total Pieces": "820", "Issue Date": "2025-12-15", "Supervisor": "Rohit", "Dori Selections": "{\"Red\":\"1 GREY\",\"BLACK\":\"Black\"}" }
];

data.customSheets["dori_purchase_orders"] = {
  meta: {
    id: "dori_purchase_orders",
    spreadsheetId: "1LjwZqU26I-OxwL1tTyps8bxSM1qS8LLUuL-sy_4COK6k",
    tabName: "DoriPurchaseOrders",
    displayName: "Dori Purchase Orders",
    category: "Materials",
    keyColumn: "Lot Number"
  },
  headers: ["Timestamp", "Lot Number", "Garment Type", "Style", "Fabric", "Total Pieces", "Issue Date", "Supervisor", "Dori Selections"],
  rows: doriRows,
  count: doriRows.length
};

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log('✅ Successfully seeded zip_purchase_orders & dori_purchase_orders into sheetsData.json!');
