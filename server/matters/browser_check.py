"""Local UI acceptance check; run only against the disposable preview."""
import sys
from urllib.parse import urlsplit
from uuid import uuid4
from playwright.sync_api import sync_playwright, expect


def check(url):
    if urlsplit(url).hostname != '127.0.0.1':
        raise ValueError('Use the synthetic loopback preview URL.')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome')
        page = browser.new_page(viewport={'width': 360, 'height': 720})
        page.goto(url)
        name = uuid4().hex[:6]
        def create(suffix):
            page.get_by_label('New folder name').fill(name + suffix)
            page.get_by_role('button', name='Create folder').click()
            expect(page.get_by_role('heading', name=name + suffix)).to_be_visible()
        def file(kind, title, body):
            page.get_by_label('Item type').select_option(kind)
            if kind == 'reference':
                page.get_by_label('Import reference').set_input_files({'name':title,'mimeType':'text/plain','buffer':body.encode()})
                expect(page.get_by_role('textbox', name='Reference text')).to_have_value(body)
            else:
                page.get_by_label('Title', exact=True).fill(title)
                page.get_by_label('Details').fill(body)
            page.get_by_role('button', name='Save ' + kind, exact=True).click()
            expect(page.locator('summary').filter(has_text=title)).to_be_visible()
        create(' A')
        file('reference','Fictional exhibit.txt','Reference material only.')
        file('note','Call note','Prepare alternate wording.')
        file('decision','Cap decision','AZURE-CANARY')
        page.locator('summary').filter(has_text='Cap decision').click()
        page.get_by_role('button', name='Summarize this decision in memory').click()
        expect(page.locator('summary').filter(has_text='Negotiated position')).to_be_visible(timeout=90000)
        create(' B')
        expect(page.get_by_text('No saved items yet.')).to_be_visible()
        page.get_by_role('button', name='Reopen summaries').click()
        expect(page.get_by_text('No decision summaries are available.')).to_be_visible(timeout=90000)
        page.reload()
        page.get_by_label('Deal folder').select_option(label=name + ' A')
        page.locator('summary').filter(has_text='Cap decision').click()
        expect(page.get_by_text('AZURE-CANARY', exact=True)).to_be_visible()
        page.get_by_role('button', name='Reopen summaries').click()
        page.locator('summary').filter(has_text='Negotiated position').click(timeout=90000)
        expect(page.get_by_text('AZURE-CANARY', exact=True)).to_have_count(2)
        expect(page.get_by_text('Sample agreement.docx (simulated)')).to_be_visible()
        browser.close()


if __name__ == '__main__':
    check(sys.argv[1])
