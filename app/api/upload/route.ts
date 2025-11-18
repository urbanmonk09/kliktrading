import { supabaseAdmin } from "@/src/lib/supabaseAdmin";
import { NextResponse } from "next/server";
import formidable from "formidable";
import fs from "fs";

// ⚠️ This is the correct way to disable Next.js body parsing in the App Router.
// You export a configuration object defining the max body size, 
// which is necessary when using libraries like formidable.
export const config = {
  api: {
    bodyParser: false,
  },
};

// Next.js App Router route handlers must be a standard async function that returns a Response.
// We DO NOT need to wrap it in a new Promise().
export async function POST(req: Request) {
  // 1. Instantiate formidable inside the handler
  const form = formidable({});
  
  // Use try/catch for proper error handling
  try {
    // 2. Parse the request using the promise-based method (recommended pattern)
    // Note: We cast req as any for formidable due to Next.js Request object differences.
    const [fields, files] = await form.parse(req as any);

    const fileArray = files.file;

    // Check if a file was actually uploaded. Formidable returns an array of files.
    if (!fileArray || fileArray.length === 0) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Get the first file object
    const file = fileArray[0];
    const fileStream = fs.readFileSync(file.filepath);
    const fileName = `${Date.now()}_${file.originalFilename}`;

    // 3. Upload file to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("your-bucket-name") // <-- replace with your bucket
      .upload(`uploads/${fileName}`, fileStream);

    if (uploadError) {
      console.error("Supabase Upload Error:", uploadError);
      return NextResponse.json(
        { error: uploadError.message || "Upload failed" }, 
        { status: 500 }
      );
    }

    // 4. Get public URL (no error returned)
    const { data: urlData } = supabaseAdmin.storage
      .from("your-bucket-name")
      .getPublicUrl(`uploads/${fileName}`);

    // 5. Return the final successful response
    return NextResponse.json({ url: urlData.publicUrl });
    
  } catch (err: any) {
    console.error("Formidable Parsing Error:", err);
    // Return a 500 status on any general processing error
    return NextResponse.json({ error: err.message || "Internal server error during processing." }, { status: 500 });
  }
}