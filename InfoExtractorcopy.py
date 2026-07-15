import os
import base64
from pathlib import Path
from dotenv import load_dotenv
from PIL import Image
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.datamodel.base_models import InputFormat
from docling_core.types.doc import PictureItem, TableItem 
from langchain_text_splitters import MarkdownHeaderTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_core.documents import Document

# 1. Setup Environment and API Keys
load_dotenv()
gemini_key = os.getenv("GEMINI_API_KEY")
embeddings_model = os.getenv("EMBEDDINGS_MODEL")
model = os.getenv("MODEL")

if not gemini_key:
    raise ValueError("Missing GEMINI_API_KEY in your .env file!")

if not embeddings_model:
    raise ValueError("Missing EMBEDDINGS_MODEL in your .env file!")

if not model:
    raise ValueError("Missing MODEL in your .env file!")

os.environ["GOOGLE_API_KEY"] = gemini_key




def analyze_pdf_layout(pdf_path):
    print(f"--- Analyzing Document Layout for: {pdf_path} ---")
    converter = DocumentConverter()
    result = converter.convert(pdf_path)
    doc = result.document

    for item, level in doc.iterate_items():
        item_type = item.label.value if hasattr(item, "label") else type(item).__name__
        text_content = item.text if hasattr(item, "text") else "None"
        clipped_text = text_content[:50].replace("\n", " ") + "..." if len(text_content) > 50 else text_content

        bbox_info = "No Coordinates"
        if hasattr(item, "prov") and item.prov:
            first_prov = item.prov[0]
            if hasattr(first_prov, "bbox") and first_prov.bbox:
                b = first_prov.bbox
                bbox_info = f"Page {first_prov.page_no} | BBox: [l={b.l:.1f}, t={b.t:.1f}, r={b.r:.1f}, b={b.b:.1f}]"

        print(f"[-] Type: {item_type:<15} | {bbox_info:<45} | Text: {clipped_text}")

def process_document_to_chunks(pdf_path: str):
    print(f"\n--- Phase 1: Processing Document to Chunks: {pdf_path} ---")
    
    output_dir = Path("./output_images")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    pipeline_options = PdfPipelineOptions()
    pipeline_options.images_scale = 2.0  # Higher resolution for VLM description
    pipeline_options.generate_picture_images = True
    
    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
        }
    )
    
    result = converter.convert(pdf_path)
    picture_counter = 0
    table_counter = 0
    doc_filename = Path(pdf_path).stem
    
    # 3. Structural Chunking via Text Headers
    markdown_text = result.document.export_to_markdown()
    print("[✓] PDF successfully converted to Markdown structural text.")
    
    headers_to_split_on = [
        ("#", "Header_1"),
        ("##", "Header_2"),
        ("###", "Header_3"),
    ]
    splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
    chunks = splitter.split_text(markdown_text)
    
    # Explicitly attach text/prose content-type metadata
    for chunk in chunks:
        chunk.metadata["content_type"] = "text_prose"

    # ---- FIX: Explicit handling and tracking of Tables and Figures ----
    for element, _level in result.document.iterate_items():
        # Handle Figures/Images
        if isinstance(element, PictureItem):
            picture_counter += 1
            img_path = output_dir / f"{doc_filename}-picture-{picture_counter}.png"
            image_obj = element.get_image(result.document)
            if image_obj:
                image_obj.save(img_path, "PNG")
        
        # Handle Tables explicitly
        elif isinstance(element, TableItem):
            table_counter += 1
            # Extract table content to a markdown format or a structured string
            table_md = element.export_to_markdown() if hasattr(element, "export_to_markdown") else str(element.text)
            
            # Formulate as a dedicated LangChain document chunk
            table_doc = Document(
                page_content=f"[Explicit Table Extraction #{table_counter}]:\n{table_md}",
                metadata={
                    "content_type": "table",
                    "source_document": doc_filename,
                    "table_index": table_counter
                }
            )
            chunks.append(table_doc)
                
    print(f"[✓] Extracted {picture_counter} images/figures into: {output_dir}/")
    print(f"[✓] Explicitly extracted and handled {table_counter} computational tables.")
    print(f"[✓] Total text + table structural chunks created: {len(chunks)}")
        
    return chunks, markdown_text

def build_vector_database(chunks, pdf_path: str):
    print(f"\n--- Phase 2: Building Local Vector Database via FAISS ---")
    
    # Initialize Google's Embedding Model (using stable embedding endpoint)
    embeddings = GoogleGenerativeAIEmbeddings(
        model=embeddings_model, 
        google_api_key=gemini_key, 
        task_type="retrieval_document"
    )
    
    doc_filename = Path(pdf_path).stem
    image_dir = Path("./output_images")
    
    # Match local images to text chunks using basic metadata injection hints
    picture_index = 1
    for chunk in chunks:
        if chunk.metadata.get("content_type") == "text_prose":
            content_lower = chunk.page_content.lower()
            if "figure" in content_lower or "illustration" in content_lower or "![" in content_lower:
                potential_img = image_dir / f"{doc_filename}-picture-{picture_index}.png"
                if potential_img.exists():
                    chunk.metadata["associated_image"] = str(potential_img.resolve())
                    picture_index += 1
                    
        if "source_document" not in chunk.metadata:
            chunk.metadata["source_document"] = doc_filename

    db = FAISS.from_documents(chunks, embeddings)
    db_save_path = "faiss_index_attention"
    db.save_local(db_save_path)
    print(f"[✓] FAISS Vector DB successfully initialized locally at: '{db_save_path}/'")
    return db

def encode_image_to_base64(image_path: Path) -> str:
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")

def enrich_vector_db_with_visuals(pdf_path: str):
    print("\n--- Phase 3: Activating Gemini Vision for Diagram Captioning ---")
    
    vlm = ChatGoogleGenerativeAI(model=model, google_api_key=gemini_key, max_retries=5)
    embeddings = GoogleGenerativeAIEmbeddings(model=embeddings_model)
    
    doc_filename = Path(pdf_path).stem
    image_dir = Path("./output_images")
    
    db_save_path = "faiss_index_attention"
    if os.path.exists(db_save_path):
        db = FAISS.load_local(db_save_path, embeddings, allow_dangerous_deserialization=True)
    else:
        raise FileNotFoundError("FAISS index not found. Please verify processing workflow.")

    image_files = sorted(list(image_dir.glob(f"{doc_filename}-picture-*.png")))
    print(f"Found {len(image_files)} diagram assets to process visually...")

    visual_documents = []

    for img_path in image_files:
        print(f" -> Analyzing visual components of: {img_path.name}")
        base64_image = encode_image_to_base64(img_path)
        
        prompt_text = (
            "You are a scientific research assistant reviewing figures from a paper. "
            "Analyze this cropped figure/diagram deeply. Provide an exhaustive technical description "
            "explaining every visible component, label, axis, line, box, table matrix elements, and structural connection. "
            "What architectural rule or piece of data does this figure convey? Do not leave out details."
        )
        
        from langchain_core.messages import HumanMessage
        message = HumanMessage(
            content=[
                {"type": "text", "text": prompt_text},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{base64_image}"}
                }
            ]
        )
        
        response = vlm.invoke([message])
        description = response.content
        
        doc = Document(
            page_content=f"[Visual Element Analysis for {img_path.name}]: {description}",
            metadata={
                "associated_image": str(img_path.resolve()),
                "source_document": doc_filename,
                "content_type": "image_description"
            }
        )
        visual_documents.append(doc)

    if visual_documents:
        print(f"\n[Embedding] Inserting {len(visual_documents)} visual contexts into shared space...")
        db.add_documents(visual_documents)
        db.save_local(db_save_path)
        print(f"[✓] FAISS Vector DB fully updated and consolidated at: '{db_save_path}/'")
    
    return db

def grounded_qa_pipeline(query: str):
    print(f"\n{'='*60}\nUSER QUERY: '{query}'\n{'='*60}")
    
    embeddings = GoogleGenerativeAIEmbeddings(model=embeddings_model)
    db_save_path = "faiss_index_attention"
    db = FAISS.load_local(db_save_path, embeddings, allow_dangerous_deserialization=True)
    
    retrieved_docs = db.similarity_search(query, k=4)
    
    print("\n--- [Retrieved Context Assets] ---")
    context_text = ""
    for idx, doc in enumerate(retrieved_docs):
        c_type = doc.metadata.get("content_type", "Standard Text/Table")
        img_ref = doc.metadata.get("associated_image", "None")
        print(f"[{idx+1}] Type: {c_type:<18} | Reference Image: {Path(img_ref).name if img_ref != 'None' else 'None'}")
        context_text += f"\n--- Context Source {idx+1} ({c_type}) ---\n{doc.page_content}\n"

    vlm = ChatGoogleGenerativeAI(model="gemini-3.1-flash-lite", google_api_key=gemini_key)
    
    system_prompt = (
        "You are a rigorous, grounded research assistant. Answer the user's question using ONLY "
        "the provided context chunks below. The chunks contain text, explicitly parsed markdown tables, and detailed "
        "descriptions of figures generated by a vision model. If the answer cannot be directly derived "
        "from the context context block, state clearly that you do not have sufficient information."
    )
    
    user_prompt = f"Context Material:\n{context_text}\n\nUser Question: {query}"
    
    from langchain_core.messages import SystemMessage, HumanMessage
    response = vlm.invoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt)
    ])
    
    print("\n--- [Grounded Gemini Answer] ---")
    print(response.content)
    print(f"\n{'='*60}\nEnd of Pipeline Execution\n{'='*60}")

# ---- FIX: Execution block running completely and handling multiple modalities ----
if __name__ == "__main__":
    # Point directly to your local file path
    PDF_FILE = "source/attention_is_all_you_need.pdf"
    
    if os.path.exists(PDF_FILE):
        print(f"[Starting Initialization] Target document verified: {PDF_FILE}")
        
        # 1. Run Layout Analysis and Chunking Conversion 
        chunks, raw_md = process_document_to_chunks(PDF_FILE)
        
        # 2. Build Base Vector Space (Prose and Explicit Tables)
        build_vector_database(chunks, PDF_FILE)
        
        # 3. Capture Visual Meanings via Multi-Modal Gemini Vision and append
        enrich_vector_db_with_visuals(PDF_FILE)
        
        # 4. Demonstrate Multi-Modal Querying Capability across distinct content spaces
        print("\n=== RUNNING TARGET MODALITY VALIDATIONS ===")
        
        # Modality A: Table extraction & verification (Checking BLEU Scores)
        grounded_qa_pipeline("What are the BLEU scores achieved by the Transformer model on the English-to-German (EN-DE) and English-to-French (EN-FR) tasks?")
        
        # Modality B: Figure/Architecture Image Description verification
        grounded_qa_pipeline("Describe the components and structure of the Encoder module shown in the architecture diagram.")
        
        # Modality C: Pure Text / Prose conceptual explanation
        grounded_qa_pipeline("What is multi-head attention and what specific computational advantages does it provide?")
        
    else:
        print(f"File not found: '{PDF_FILE}'. Please put the 'Attention Is All You Need' PDF file in the correct folder path.")