# Genera solicitudes de concurso FICTICIAS en PDF para las pruebas del lector.
# Ningún dato corresponde a personas reales. Requiere: pip install reportlab
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, PageBreak
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'test', 'fixtures', 'solicitudes')
st = getSampleStyleSheet()
P = lambda t: Paragraph(t, st['Normal'])
H = lambda t: Paragraph(t, st['Heading3'])

def doc(nombre, partes):
    d = SimpleDocTemplate(os.path.join(OUT, nombre), pagesize=A4, title='Solicitud ficticia', author='Pruebas', creator='autos-concurso-sin-masa', producer='autos-concurso-sin-masa', invariant=1)
    d.build(partes)

# 1) Escrito clásico: concurso voluntario sin masa, persona física, con relación de acreedores y EPI en otrosí
acreedores = [['Acreedor', 'NIF', 'Concepto', 'Garantía', 'Importe'],
    ['Banco Ficticio, S.A.', 'A00000001', 'Préstamo personal', 'Personal', '12.000,00 €'],
    ['Financiera Ejemplo, S.A.', 'A00000002', 'Tarjeta de crédito', 'Personal', '1.750,21 €'],
    ['Agencia Estatal de Administración Tributaria', 'Q2826000H', 'IRPF 2023 y recargos', 'Personal', '8.000,00 €'],
    ['Tesorería General de la Seguridad Social', 'Q2827003A', 'Cuotas RETA', 'Personal', '2.400,00 €'],
    ['Ayuntamiento Ficticio', 'P0800000A', 'IBI 2024', 'Personal', '640,50 €']]
doc('01-sin-masa-escrito.pdf', [
    P('AL JUZGADO DE LO MERCANTIL DE BARCELONA QUE POR TURNO CORRESPONDA'),
    P('(Sección de lo Mercantil del Tribunal de Instancia de Barcelona)'), Spacer(1, 12),
    P('DOÑA PROCURADORA EJEMPLO, Procuradora de los Tribunales, en nombre y representación de DON PERSONA DEUDORA EJEMPLO, mayor de edad, con DNI 00000000T, y domicilio en Calle Inventada 1, 08850 Gavà (Barcelona), según acredito mediante poder que se acompaña como documento n.º 1, bajo la dirección letrada de DON ABOGADO EJEMPLO, colegiado del ICAB, ante el Juzgado comparezco y, como mejor proceda en Derecho, DIGO:'),
    P('Que por medio del presente escrito formulo SOLICITUD DE CONCURSO VOLUNTARIO SIN MASA de persona física no empresaria, de conformidad con los artículos 37 bis y siguientes del texto refundido de la Ley Concursal, en base a los siguientes'),
    H('HECHOS'),
    P('PRIMERO.- Mi mandante se encuentra en situación de insolvencia actual, pues no puede cumplir regularmente sus obligaciones exigibles, como consecuencia del desempleo y del sobreendeudamiento.'),
    P('SEGUNDO.- Estado civil: divorciado. No tiene personas a su cargo. Su domicilio no ha variado en los últimos seis meses.'),
    P('TERCERO.- El deudor carece de bienes y derechos legalmente embargables. El valor total de sus bienes y derechos asciende a 350,00 euros, correspondientes al saldo de una cuenta corriente. El importe global de sus deudas asciende a 24.790,71 euros.'),
    P('CUARTO.- Se acompaña memoria (documento n.º 2), inventario de bienes y derechos (documento n.º 3), relación de acreedores (documento n.º 4) y el formulario del Anexo I de los Acuerdos de unificación de criterios (documento n.º 5).'),
    H('RELACIÓN DE ACREEDORES'),
    Table(acreedores),
    Spacer(1, 12),
    H('FUNDAMENTOS DE DERECHO'),
    P('Son de aplicación los artículos 2, 6, 7 y 37 bis del texto refundido de la Ley Concursal.'),
    H('SUPLICO'),
    P('Que se tenga por presentada la solicitud de concurso voluntario sin masa de DON PERSONA DEUDORA EJEMPLO y se dicte auto declarándolo conforme al artículo 37 ter TRLC.'),
    P('OTROSÍ DIGO: que, de no solicitarse el nombramiento de administración concursal, mi mandante interesa la exoneración del pasivo insatisfecho.'),
    P('En Gavà, a 3 de marzo de 2026.'),
])

# 2) Formulario ICAB (Anexo I) rellenado
doc('02-formulario-icab.pdf', [
    P('ANEXO I. FORMULARIO DE SOLICITUD DE CONCURSO SIN MASA DE PERSONA FÍSICA'),
    H('I. IDENTIFICACIÓN DEL DEUDOR'),
    P('1. Nombre y apellidos: MARIA EJEMPLO FICTICIA'),
    P('NIF: 00000001R'),
    P('2. Domicilio: Carrer Imaginari 22, 08401 Granollers (Barcelona)'),
    P('5. Modificación del domicilio en los últimos seis meses: [X] No'),
    P('7. Estado civil: [X] casado'),
    P('8. Régimen económico matrimonial: [X] Separación de bienes'),
    P('10. Personas a su cargo o a quienes deba satisfacer alimentos: [X] Sí. Dos hijos menores.'),
    H('II. SITUACIÓN DE INSOLVENCIA'),
    P('1. Tipo de insolvencia: [X] Actual, si ya no puede cumplir regularmente sus obligaciones exigibles.'),
    P('2. Hechos de los que deriva su situación de insolvencia: [X] Desempleo [X] Inflación'),
    P('3. Estimación del importe global de las deudas: 18.300,00 €'),
    P('4. Estimación del importe global del valor de los bienes y derechos: 0,00 €'),
    H('IV. ACREEDORES, CONTRATOS Y GASTOS'),
    P('1. Número de acreedores: 3'),
    Table([['Fecha', 'Acreedor', 'Correo electrónico', 'Tipo de contrato', 'Importe', 'Garantía'],
           ['01/02/2021', 'Wizink Ficticio, S.A.', 'a@ejemplo.test', 'Tarjeta revolving', '9.300,00 €', 'Personal'],
           ['15/06/2022', 'Cofidis Ficticio, S.A.', 'b@ejemplo.test', 'Préstamo consumo', '6.000,00 €', 'Personal'],
           ['10/01/2020', 'Excónyuge (alimentos)', '', 'Pensión alimentos', '3.000,00 €', 'Personal']], style=[('FONTSIZE',(0,0),(-1,-1),8)]),
    H('5. Relación de gastos mensuales'),
    Table([['Tipo de gasto', 'Cuantía', 'Periodicidad'], ['Alquiler vivienda', '650,00 €', 'Mensual'], ['Suministros', '120,00 €', 'Mensual']]),
    P('Granollers, 12 de mayo de 2026'),
])

# 3) Concurso ordinario con masa (vivienda con hipoteca): no es sin masa
doc('03-ordinario-con-masa.pdf', [
    P('AL JUZGADO DE LO MERCANTIL DE BARCELONA'),
    P('DON PROCURADOR EJEMPLO, en nombre de DOÑA DEUDORA CON VIVIENDA, con NIE X0000000T, domiciliada en Terrassa, formula SOLICITUD DE CONCURSO VOLUNTARIO de acreedores de persona física por insolvencia inminente.'),
    P('La deudora es titular de la vivienda habitual, valorada en 210.000,00 euros, gravada con hipoteca a favor de Banco Hipotecario Ficticio, S.A. Solicita la exoneración del pasivo insatisfecho con plan de pagos.'),
    H('RELACIÓN DE ACREEDORES'),
    Table([['Acreedor', 'Concepto', 'Garantía', 'Importe'],
           ['Banco Hipotecario Ficticio, S.A.', 'Préstamo hipotecario vivienda', 'Hipotecaria', '150.000,00 €'],
           ['Proveedor Ejemplo, S.L.', 'Facturas', 'Personal', '4.200,00 €']]),
    P('En Terrassa, a 20 de abril de 2026.'),
])
print('ok')
