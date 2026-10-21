window.ReceivedImageSelection = class {
    constructor(container, files, onChange) {
        this.files = files;
        this.urls = [];
        this.checkboxes = [];
        container.replaceChildren();
        const toolbar = document.createElement('label'); toolbar.className = 'receive-select-all';
        this.all = document.createElement('input'); this.all.type = 'checkbox'; this.all.checked = true;
        this.count = document.createElement('span');
        toolbar.append(this.all, this.count); container.append(toolbar);
        const grid = document.createElement('div'); grid.className = 'receive-image-grid'; container.append(grid);
        const update = () => {
            const count = this.selected().length;
            this.all.checked = count === files.length;
            this.all.indeterminate = count > 0 && count < files.length;
            this.count.textContent = `全选 · 已选 ${count}/${files.length} 张`;
            onChange(count);
        };
        files.forEach(file => {
            const label = document.createElement('label'); label.className = 'receive-image-option';
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true;
            checkbox.setAttribute('aria-label', `选择 ${file.name}`);
            const img = document.createElement('img'); img.alt = file.name; img.loading = 'lazy';
            const url = URL.createObjectURL(file); this.urls.push(url); img.src = url;
            img.onerror = () => {img.style.visibility = 'hidden';};
            const name = document.createElement('span'); name.textContent = file.name;
            label.append(checkbox,img,name); grid.append(label);
            this.checkboxes.push(checkbox); checkbox.addEventListener('change', update);
        });
        this.all.addEventListener('change', () => {this.checkboxes.forEach(box => {box.checked = this.all.checked;}); update();});
        update();
    }
    selected() {return this.files.filter((_,index) => this.checkboxes[index].checked);}
    destroy() {this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = [];}
    static async archive(files) {
        const writer = new zip.ZipWriter(new zip.BlobWriter('application/zip'), {bufferedWrite:true,level:0});
        const used = new Set();
        for (const file of files) {
            let name = file.name, index = 1;
            while (used.has(name)) name = `${index++}_${file.name}`;
            used.add(name);
            await writer.add(name,new zip.BlobReader(file));
        }
        return writer.close();
    }
};
