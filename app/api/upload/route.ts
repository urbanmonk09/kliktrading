import { supabaseAdmin } from "@/src/lib/supabaseAdmin";
import { NextResponse } from "next/server";
import formidable from "formidable";
import fs from "fs";

export const runtime = "nodejs";
export const requestBodyParser = false;

export async function POST(req: Request) {
  const form = formidable();

  try {
    const [fields, files] = await form.parse(req as any);

    const fileArray = files.file;

    if (!fileArray || fileArray.length === 0) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const file = fileArray[0];
    const fileStream = fs.readFileSync(file.filepath);
    const fileName = `${Date.now()}_${file.originalFilename}`;

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("your-bucket-name")
      .upload(`uploads/${fileName}`, fileStream);

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message || "Upload failed" }, { status: 500 });
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("your-bucket-name")
      .getPublicUrl(`uploads/${fileName}`);

    return NextResponse.json({ url: urlData.publicUrl });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
