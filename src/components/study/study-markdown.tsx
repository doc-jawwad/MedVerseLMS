import { renderStudyMarkdown } from "@/lib/study/markdown";

export function StudyMarkdown({ source }: { source: string }) {
  return (
    <article
      className="max-w-none text-[15px] leading-7 text-[#072855] [&_h1]:mb-3 [&_h1]:font-heading [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-semibold [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_strong]:font-semibold"
      dangerouslySetInnerHTML={{ __html: renderStudyMarkdown(source) }}
    />
  );
}
