import zipfile
import xml.etree.ElementTree as ET
import sys

def inspect_xlsx(file_path, output_path):
    out_lines = []
    out_lines.append(f"Inspecting file: {file_path}")
    try:
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            # Read shared strings
            shared_strings = []
            if 'xl/sharedStrings.xml' in zip_ref.namelist():
                with zip_ref.open('xl/sharedStrings.xml') as f:
                    tree = ET.parse(f)
                    root = tree.getroot()
                    # Namespaces
                    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                    for t in root.findall('.//ns:t', ns):
                        shared_strings.append(t.text if t.text else "")
            
            # Read sheet1.xml (first sheet data)
            rows = []
            if 'xl/worksheets/sheet1.xml' in zip_ref.namelist():
                with zip_ref.open('xl/worksheets/sheet1.xml') as f:
                    tree = ET.parse(f)
                    root = tree.getroot()
                    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                    
                    for r in root.findall('.//ns:row', ns):
                        row_data = []
                        for c in r.findall('ns:c', ns):
                            v = c.find('ns:v', ns)
                            val = ""
                            if v is not None:
                                val = v.text
                                t = c.get('t')
                                if t == 's': # Shared string
                                    val = shared_strings[int(val)]
                            row_data.append(val)
                        rows.append(row_data)
                        if len(rows) >= 50: # Get first 50 rows
                            break
            
            out_lines.append(f"\nTotal rows loaded: {len(rows)}")
            out_lines.append("\nFirst 40 rows found:")
            for i, row in enumerate(rows[:40]):
                out_lines.append(f"Row {i+1}: {row}")
                
    except Exception as e:
        out_lines.append(f"Error reading xlsx: {str(e)}")
        
    with open(output_path, 'w', encoding='utf-8') as out_f:
        out_f.write("\n".join(out_lines))
    print(f"Inspection complete. Written to {output_path}")

inspect_xlsx(
    r"d:\INNOCREW\GramPanchayatAutomation\MilkatnoswisemobilenoReport (1).xlsx",
    r"d:\INNOCREW\GramPanchayatAutomation\backend\scratch\inspect_output.txt"
)
