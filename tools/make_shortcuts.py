# Arma los atajos de Finanzas (formato plist de Atajos de Apple) con la clave personal adentro.
# Uso: python3 -I tools/make_shortcuts.py <carpeta-salida> <clave-personal> '["Mercado","Salidas"]'
# Luego: shortcuts sign --mode anyone -i "X (sin firmar).shortcut" -o "X.shortcut". Guardar solo en datos-privados/ (llevan la clave).
import plistlib, uuid, sys, os, json

out_dir, key, budgets_json = sys.argv[1], sys.argv[2], sys.argv[3]
budgets = json.loads(budgets_json)
BASE = 'https://ihmpzymyjlgskebtpmvq.supabase.co/rest/v1/rpc/'
APIKEY = 'sb_publishable_2EtNj3kprt5YbSvK562aeQ_4YtdV6Bl'
OBJ = '￼'

def text(s, att=None):
    v = {'string': s}
    if att:
        v['attachmentsByRange'] = {f'{{{pos}, 1}}': a for pos, a in att}
    return {'Value': v, 'WFSerializationType': 'WFTextTokenString'}

def out(u, name): return {'OutputUUID': u, 'Type': 'ActionOutput', 'OutputName': name}
def var(u, name): return text(OBJ, [(0, out(u, name))])
def ext_input(): return text(OBJ, [(0, {'Type': 'ExtensionInput'})])

def dict_field(items):
    return {'Value': {'WFDictionaryFieldValueItems': [
        {'WFItemType': 0, 'WFKey': text(k), 'WFValue': v} for k, v in items]},
        'WFSerializationType': 'WFDictionaryFieldValue'}

def act(ident, **params): return {'WFWorkflowActionIdentifier': ident, 'WFWorkflowActionParameters': params}

def ask(prompt, kind):
    u = str(uuid.uuid4()).upper()
    return u, act('is.workflow.actions.ask', WFAskActionPrompt=prompt, WFInputType=kind, UUID=u)

def call(fn, fields):
    u = str(uuid.uuid4()).upper()
    return u, act('is.workflow.actions.downloadurl',
        WFURL=BASE + fn, WFHTTPMethod='POST', ShowHeaders=True,
        WFHTTPHeaders=dict_field([('apikey', text(APIKEY)), ('Accept', text('text/plain'))]),
        WFHTTPBodyType='JSON',
        WFJSONValues=dict_field([('clave', text(key))] + fields), UUID=u)

def show(u): return act('is.workflow.actions.showresult', Text=var(u, 'Contents of URL'))

def choose_budget(prompt):
    ul, ulist = str(uuid.uuid4()).upper(), None
    items = budgets + ['Sin presupuesto']
    ulist = act('is.workflow.actions.list', WFItems=items, UUID=ul)
    uc = str(uuid.uuid4()).upper()
    choose = act('is.workflow.actions.choosefromlist', WFInput=var(ul, 'List'), WFChooseFromListActionPrompt=prompt, UUID=uc)
    return uc, [ulist, choose]

def workflow(actions, color, accepts_input=False):
    return {
        'WFWorkflowActions': actions,
        'WFWorkflowClientVersion': '2605.0.5',
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconStartColor': color, 'WFWorkflowIconGlyphNumber': 59511},
        'WFWorkflowImportQuestions': [],
        'WFWorkflowInputContentItemClasses': ['WFStringContentItem', 'WFRichTextContentItem', 'WFGenericFileContentItem'] if accepts_input else [],
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowTypes': ['Watch'] if not accepts_input else [],
        'WFWorkflowHasShortcutInputVariables': accepts_input,
    }

GREEN, BLUE, PURPLE = 431817727, 4282601983, 2846468607

# 1. Anotar gasto
u1, a1 = ask('¿Cuánto fue?', 'Number')
u2, a2 = ask('¿En qué?', 'Text')
ub, chooser = choose_budget('¿De qué presupuesto?')
u3, a3 = call('atajo_gasto', [('monto', var(u1, 'Provided Input')), ('concepto', var(u2, 'Provided Input')),
                              ('presupuesto', var(ub, 'Chosen Item'))])
shortcuts = {'Anotar gasto': workflow([a1, a2, *chooser, a3, show(u3)], GREEN)}

# 2. Cuánto tengo libre
u4, a4 = call('atajo_resumen', [])
shortcuts['Cuánto tengo libre'] = workflow([a4, show(u4)], BLUE)

# 3. Me alcanza
u5, a5 = ask('¿Cuánto cuesta?', 'Number')
ub2, chooser2 = choose_budget('¿De qué es?')
u6, a6 = call('atajo_alcanza', [('monto', var(u5, 'Provided Input')), ('presupuesto', var(ub2, 'Chosen Item'))])
shortcuts['Me alcanza'] = workflow([a5, *chooser2, a6, show(u6)], PURPLE)

# 4. Registrar SMS: lo llama la automatización de Mensajes con el SMS del banco como entrada.
u7, a7 = call('atajo_mensaje', [('texto', ext_input())])
notify = act('is.workflow.actions.notification', WFNotificationActionTitle='Finanzas',
             WFNotificationActionBody=var(u7, 'Contents of URL'))
shortcuts['Registrar SMS'] = workflow([a7, notify], GREEN, accepts_input=True)

for name, wf in shortcuts.items():
    path = os.path.join(out_dir, f'{name} (sin firmar).shortcut')
    with open(path, 'wb') as f:
        plistlib.dump(wf, f, fmt=plistlib.FMT_BINARY)
    print('ok', name)
