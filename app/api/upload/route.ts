import { supabaseAdmin } from "@/src/lib/supabaseAdmin";
import { NextResponse } from "next/server";
import formidable from "formidable";
import fs from "fs";

// Disable Next.js default body parsing
export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(req: Request) {
  return new Promise((resolve) => {
    const form = new formidable.IncomingForm();

    form.parse(req as any, async (err: Error | null, fields: any, files: any) => {
      if (err) return resolve(NextResponse.json({ error: err.message }, { status: 500 }));

      if (!files.file) return resolve(NextResponse.json({ error: "No file uploaded" }, { status: 400 }));

      const file = files.file;
      const fileStream = fs.readFileSync(file.filepath);
      const fileName = `${Date.now()}_${file.originalFilename}`;

      // Upload file to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from("your-bucket-name") // <-- replace with your bucket
        .upload(`uploads/${fileName}`, fileStream);

      if (uploadError) {
        return resolve(NextResponse.json({ error: (uploadError as any).message || "Upload failed" }, { status: 500 }));
      }

      // Get public URL (no error returned)
      const { data: urlData } = supabaseAdmin.storage
        .from("your-bucket-name")
        .getPublicUrl(`uploads/${fileName}`);

      resolve(NextResponse.json({ url: urlData.publicUrl }));
    });
  });
}
